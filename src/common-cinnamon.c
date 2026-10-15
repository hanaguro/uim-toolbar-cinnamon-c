/* vim: set tabstop=4 shiftwidth=4 softtabstop=4 expandtab: */

/* uim helper 接続と prop_list_update 状態管理。
 * GTK3 ツールバー common-gtk.c の UI 部分を Cinnamon アプレットへ移し、
 * helper 接続・メッセージ解析・prop_activate 送信のみを担う。 */

#include "common-cinnamon.h"

#include <gio/gio.h>
#include <glib.h>
#include <glib/gi18n.h>

#include <ctype.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>

#include <uim/uim.h>
#include <uim/uim-custom.h>
#include <uim/uim-helper.h>
#include <uim/uim-scm.h>

#define TOOLBAR_PIXMAPS_DIR "/usr/share/uim/pixmaps"

/* GTK3 版 command_entry[] と同一仕様（desc/label/icon/command/
 * custom_button_show_symbol）。toolbar-show-*-button? が真の項目は
 * アプレット側でツールバー本体内にインラインのツールボタンとして
 * 並べる（GTK3 版 append_tool_button / LXQt 版と同じ）。
 * 右クリックメニューは GTK3 版 right_click_menu_create と同様、
 * show_button とは独立に全項目を常時表示する。 */
static struct _CommandEntry {
    const char *desc;
    const char *label;
    const char *icon;
    const char *command;
    const char *custom_button_show_symbol;
} command_entry[] = {
    {N_("Switch input method"), NULL, "im_switcher", "uim-im-switcher-gtk3",
     "toolbar-show-switcher-button?"},
    {N_("Preference"), NULL, "preferences", "uim-pref-gtk3",
     "toolbar-show-pref-button?"},
    {N_("Japanese dictionary editor"), NULL, "uim-dict", "uim-dict-gtk3",
     "toolbar-show-dict-button?"},
    {N_("Input pad"), NULL, "input_pad", "uim-input-pad-ja-gtk3",
     "toolbar-show-input-pad-button?"},
    {N_("Handwriting input pad"), "H", "handwriting", "uim-tomoe-gtk",
     "toolbar-show-handwriting-input-pad-button?"},
    {N_("Help"), NULL, "help", "uim-help",
     "toolbar-show-help-button?"},
};

/* 構造体の配列サイズに使うため、C の整数定数式である必要がある。
 * const guint の変数では定数式にならない（VLA 扱いになりエラー）ため
 * sizeof 式を直接使うマクロにする */
#define command_entry_len \
    (sizeof(command_entry) / sizeof(command_entry[0]))

struct _UimToolbarCommon {
    int fd;
    GIOChannel *chan;
    guint watch_id;
    gboolean reconnect_scheduled;

    /* GTK3 版 prop_button_create と同じく branch 行ごとに 1 グループ
     * （複数 IM ジョブ/モード群があると枝が複数並ぶ） */
    GList *branches; /* UimToolbarBranch* */

    gboolean is_connected;
    gboolean is_toolbar_visible;
    gboolean with_dark_bg;
    gboolean custom_enabled; /* GTK3 版 custom_enabled 相当 */
    gboolean show_buttons[command_entry_len]; /* GTK3 版 show_button 相当 */

    GMainLoop *main_loop; /* uim_toolbar_common_quit 用 */
    void (*state_changed_cb)(void *user_data);
    void *state_changed_data;
};

static gboolean fd_read_cb(GIOChannel *source, GIOCondition condition,
                           gpointer data);
static void helper_disconnect_cb(void);
static void helper_reconnect(UimToolbarCommon *self);
static void parse_prop_list_update(UimToolbarCommon *self, gchar **lines);
static void free_branches(UimToolbarCommon *self);
static void check_custom(UimToolbarCommon *self);
static gboolean icon_exists(const char *name);
static void helper_reconnect(UimToolbarCommon *self);

/* 再接続コールバックは self なしで呼ばれる（uim_helper_init_client_fd の
 * シグネチャが void (*)(void) のため、単一インスタンスを静的参照する）。 */
static UimToolbarCommon *the_instance = NULL;

UimToolbarCommon *uim_toolbar_common_new(void)
{
    UimToolbarCommon *self = g_new0(UimToolbarCommon, 1);
    self->fd = -1;
    self->watch_id = 0;
    self->reconnect_scheduled = FALSE;
    self->branches = NULL;
    self->is_connected = FALSE;
    self->is_toolbar_visible = TRUE;
    self->with_dark_bg =
        uim_scm_symbol_value_bool("toolbar-icon-for-dark-background?");
    /* GTK3 版 common-gtk.c と同じ: uim-toolbar-save-default-im? が真の
     * 場合のみ uim-custom を有効化する（custom-groups 未初期化で
     * custom-set-value! が unbound variable になるのを防ぐ）。 */
    if (uim_scm_symbol_value_bool("uim-toolbar-save-default-im?"))
        self->custom_enabled = (gboolean)uim_custom_enable();
    else
        self->custom_enabled = FALSE;
    /* GTK3 版 toolbar_new() は helper_toolbar_check_custom() を init 時に
     * 無条件で呼ぶ。custom_reload_notify 受信時だけ呼ぶと
     * command_entry[].show_button が全項目 UIM_FALSE のままになり
     * GetState の commands が常に空になる。 */
    check_custom(self);
    the_instance = self;
    return self;
}

void uim_toolbar_common_free(UimToolbarCommon *self)
{
    if (!self)
        return;
    if (self->watch_id) {
        g_source_remove(self->watch_id);
        self->watch_id = 0;
    }
    if (self->chan) {
        g_io_channel_unref(self->chan);
        self->chan = NULL;
    }
    if (self->fd != -1) {
        uim_helper_close_client_fd(self->fd);
        self->fd = -1;
    }
    free_branches(self);
    if (the_instance == self)
        the_instance = NULL;
    g_free(self);
}

/* ===== helper 接続（GTK3 版 uim_toolbar_check_helper_connection 相当） ===== */

void uim_toolbar_common_connect(UimToolbarCommon *self)
{
    if (self->fd >= 0)
        return;
    self->fd = uim_helper_init_client_fd(helper_disconnect_cb);
    if (self->fd < 0) {
        g_warning("uim-toolbar-cinnamon: unable to connect to uim-helper "
                  "server");
        return;
    }
    self->chan = g_io_channel_unix_new(self->fd);
    self->watch_id = g_io_add_watch(self->chan, G_IO_IN | G_IO_HUP | G_IO_ERR,
                                    fd_read_cb, self);
    self->is_connected = TRUE;
    self->reconnect_scheduled = FALSE;
    uim_helper_client_get_prop_list();
}

static void helper_disconnect_cb(void)
{
    UimToolbarCommon *self = the_instance;
    if (!self)
        return;
    self->fd = -1;
    self->is_connected = FALSE;
    if (self->watch_id) {
        g_source_remove(self->watch_id);
        self->watch_id = 0;
    }
    if (self->chan) {
        g_io_channel_unref(self->chan);
        self->chan = NULL;
    }
    helper_reconnect(self);
}

static gboolean reconnect_cb(gpointer data)
{
    UimToolbarCommon *self = (UimToolbarCommon *)data;
    self->reconnect_scheduled = FALSE;
    uim_toolbar_common_connect(self);
    return FALSE; /* once */
}

static void helper_reconnect(UimToolbarCommon *self)
{
    if (self->reconnect_scheduled)
        return;
    self->reconnect_scheduled = TRUE;
    g_timeout_add_seconds(1, reconnect_cb, self);
}

static gboolean fd_read_cb(GIOChannel *channel, GIOCondition c, gpointer p)
{
    (void)c;
    UimToolbarCommon *self = (UimToolbarCommon *)p;
    int fd = g_io_channel_unix_get_fd(channel);
    char *msg;

    uim_helper_read_proc(fd);

    while ((msg = uim_helper_get_message())) {
        gchar **lines = g_strsplit(msg, "\n", 0);
        if (lines && lines[0]) {
            if (!strcmp("prop_list_update", lines[0]))
                parse_prop_list_update(self, lines);
            else if (!strcmp("custom_reload_notify", lines[0])) {
                uim_prop_reload_configs();
                check_custom(self);
                /* toolbar-show-*-button? の変更をアプレット側
                 * （インラインツールボタン）へ反映させる */
                if (self->state_changed_cb)
                    self->state_changed_cb(self->state_changed_data);
            }
        }
        g_strfreev(lines);
        free(msg);
    }
    /* uim_helper_read_proc 中に切断され helper_disconnect_cb が watch を
     * 解除済みの場合は FALSE を返して GLib 側に自然に破棄させる
     * （g_source_remove の二重解除を防ぐ）。 */
    if (!self->is_connected) {
        self->watch_id = 0;
        return FALSE;
    }
    return TRUE;
}

/* ===== prop_list_update 解析（GTK3 版 helper_toolbar_prop_list_update 相当）
 * 行形式:
 *   branch\t<indication_id>\t<iconic_label>\t<description>
 *   leaf\t<indication_id>\t<iconic_label>\t<label>\t<tooltip>\t<action>\t<state>
 * ===== */

/* GTK3 版 safe_gettext と同一。ASCII のみの msgid のみ gettext を適用する
 * （多言語混在時に日本語ラベル等が化けるのを防ぐ）。 */
static const char *safe_gettext(const char *msgid)
{
    const char *p;

    for (p = msgid; *p && isascii(*p); p++)
        continue;

    return (*p) ? msgid : gettext(msgid);
}

static char *convert_charset(const char *charset, const char *str)
{
    if (!charset || !strcmp(charset, "UTF-8"))
        return g_strdup(str);
    return g_convert(str, -1, "UTF-8", charset, NULL, NULL, NULL);
}

static void free_branches(UimToolbarCommon *self)
{
    for (GList *it = self->branches; it; it = it->next) {
        UimToolbarBranch *b = (UimToolbarBranch *)it->data;
        for (GList *lt = b->leaves; lt; lt = lt->next) {
            UimToolbarPropEntry *e = (UimToolbarPropEntry *)lt->data;
            g_free(e->label);
            g_free(e->tooltip);
            g_free(e->icon);
            g_free(e->action);
            g_free(e);
        }
        g_list_free(b->leaves);
        g_free(b->label);
        g_free(b->tooltip);
        g_free(b->icon);
        g_free(b);
    }
    g_list_free(self->branches);
    self->branches = NULL;
}

static int count_cols(char **cols)
{
    int n = 0;
    while (cols[n])
        n++;
    return n;
}

static void parse_prop_list_update(UimToolbarCommon *self, gchar **lines)
{
    char *charset = NULL;
    char *display_time;
    gboolean is_hidden;
    guint i;
    GList *new_branches = NULL;
    UimToolbarBranch *cur = NULL;

    for (i = 1; lines[i]; i++) {
        if (!strcmp(lines[i], ""))
            break;
        if (!strncmp(lines[i], "charset=", 8)) {
            charset = lines[i] + 8;
            break;
        }
    }

    /* GTK3 版と同様 toolbar-display-time で表示/非表示を決める */
    display_time = uim_scm_symbol_value_str("toolbar-display-time");
    is_hidden = strcmp(display_time, "mode") ? TRUE : FALSE;

    free_branches(self);

    for (i = 1; lines[i] && strcmp("", lines[i]); i++) {
        char *utf8_str = convert_charset(charset, lines[i]);
        gchar **cols;

        if (utf8_str) {
            cols = g_strsplit(utf8_str, "\t", 0);
            g_free(utf8_str);
        } else {
            cols = g_strsplit(lines[i], "\t", 0);
        }

        if (cols && cols[0]) {
            if (!strcmp("branch", cols[0]) && count_cols(cols) >= 4) {
                const char *indication_id = cols[1];
                /* GTK3 版 prop_button_create と同じく branch 行ごとに
                 * 新しい枝を作る（例: SKK なら [Sk][あ][Ｒ] の 3 枝） */
                cur = g_new0(UimToolbarBranch, 1);
                cur->label = g_strdup(safe_gettext(cols[2]));
                cur->tooltip = g_strdup(safe_gettext(cols[3]));
                cur->icon = g_strdup(indication_id);
                cur->leaves = NULL;
                new_branches = g_list_append(new_branches, cur);
                if (!is_hidden && (!strcmp(indication_id, "direct") ||
                                   g_str_has_suffix(indication_id, "_direct")))
                    is_hidden = TRUE;
            } else if (!strcmp("leaf", cols[0]) && count_cols(cols) >= 7) {
                UimToolbarPropEntry *e = g_new0(UimToolbarPropEntry, 1);
                e->label = g_strdup(safe_gettext(cols[3]));
                e->tooltip = g_strdup(safe_gettext(cols[4]));
                e->icon = g_strdup(cols[1]);
                e->action = g_strdup(cols[5]);
                e->selected = !strcmp(cols[6], "*");
                if (cur) {
                    cur->leaves = g_list_append(cur->leaves, e);
                } else {
                    g_free(e->label);
                    g_free(e->tooltip);
                    g_free(e->icon);
                    g_free(e->action);
                    g_free(e);
                }
            }
        }
        g_strfreev(cols);
    }

    self->branches = new_branches;

    is_hidden = (is_hidden && strcmp(display_time, "always")) ? TRUE : FALSE;
    self->is_toolbar_visible = !is_hidden;

    g_free(display_time);

    if (self->state_changed_cb)
        self->state_changed_cb(self->state_changed_data);
}

/* ===== 設定（GTK3 版 helper_toolbar_check_custom 相当） ===== */

static void check_custom(UimToolbarCommon *self)
{
    guint i;

    self->with_dark_bg =
        uim_scm_symbol_value_bool("toolbar-icon-for-dark-background?");

    /* GTK3 版 helper_toolbar_check_custom() と同じ:
     * toolbar-show-*-button? でインラインツールボタンの表示/非表示を決める */
    for (i = 0; i < command_entry_len; i++)
        self->show_buttons[i] =
            uim_scm_symbol_value_bool(
                command_entry[i].custom_button_show_symbol);
}

/* ===== アイコン（GTK3 版 register_icon のファイル探索と同じ規則） ===== */

static gboolean icon_exists(const char *name)
{
    char path[512];
    struct stat st;
    g_snprintf(path, sizeof(path), "%s/%s.png", TOOLBAR_PIXMAPS_DIR, name);
    if (stat(path, &st) == 0)
        return TRUE;
    return FALSE;
}

char *uim_toolbar_common_icon_path(UimToolbarCommon *self, const char *name)
{
    if (!name || !*name)
        return NULL;

    if (self->with_dark_bg) {
        char *dark = g_strdup_printf("%s/%s_dark_background.png",
                                     TOOLBAR_PIXMAPS_DIR, name);
        if (g_file_test(dark, G_FILE_TEST_EXISTS))
            return dark;
        g_free(dark);
    }
    if (icon_exists(name))
        return g_strdup_printf("%s/%s.png", TOOLBAR_PIXMAPS_DIR, name);
    return NULL;
}

/* ===== action 送信（GTK3 版 prop_menu_activate 相当） ===== */

static gboolean is_msg_imsw(const char *str)
{
    return !strncmp(str, "action_imsw_", strlen("action_imsw_"));
}

static const char *get_imsw_im(const char *str)
{
    return str + strlen("action_imsw_");
}

static gboolean is_imsw_coverage_system_global(void)
{
    char *coverage = uim_scm_symbol_value_str("imsw-coverage");
    gboolean ret;
    if (!coverage)
        return FALSE;
    ret = (gboolean)!strcmp(coverage, "system-global");
    g_free(coverage);
    return ret;
}

static void save_default_im(const char *im)
{
    uim_scm_callf("custom-set-value!", "yy",
                  "custom-preserved-default-im-name", im);
    uim_custom_save_custom("custom-preserved-default-im-name");
}

gboolean uim_toolbar_common_activate_action(UimToolbarCommon *self,
                                            const char *action, char **error)
{
    if (!action || !*action) {
        if (error)
            *error = g_strdup("empty action");
        return FALSE;
    }
    if (self->fd < 0) {
        if (error)
            *error = g_strdup("not connected to uim-helper server");
        return FALSE;
    }
    char *msg = g_strdup_printf("prop_activate\n%s\n", action);
    uim_helper_send_message(self->fd, msg);
    g_free(msg);

    if (is_msg_imsw(action) && self->custom_enabled &&
        is_imsw_coverage_system_global())
        save_default_im(get_imsw_im(action));

    /* 状態は prop_list_update で返ってくる */
    return TRUE;
}

/* ===== ヘルパーアプリ起動（GTK3 版 uim_toolbar_launch_helper_application
 * 相当） ===== */

gboolean uim_toolbar_common_launch_helper(UimToolbarCommon *self,
                                          const char *command, char **error)
{
    (void)self;
    char *argv[] = {(char *)command, NULL};
    GError *gerr = NULL;
    if (!g_spawn_async(NULL, argv, NULL,
                       G_SPAWN_SEARCH_PATH | G_SPAWN_DO_NOT_REAP_CHILD, NULL,
                       NULL, NULL, &gerr)) {
        if (error)
            *error = g_strdup(gerr ? gerr->message : "spawn failed");
        if (gerr)
            g_error_free(gerr);
        return FALSE;
    }
    return TRUE;
}

const char *uim_toolbar_common_helper_command(UimToolbarCommon *self,
                                              const char *desc)
{
    (void)self;
    for (guint i = 0; i < command_entry_len; i++)
        if (!strcmp(command_entry[i].desc, desc))
            return command_entry[i].command;
    return NULL;
}

GList *uim_toolbar_common_command_entries(UimToolbarCommon *self)
{
    GList *list = NULL;
    for (guint i = 0; i < command_entry_len; i++) {
        UimToolbarCommandEntry *c = g_new0(UimToolbarCommandEntry, 1);
        c->desc = g_strdup(_(command_entry[i].desc));
        c->label = g_strdup(command_entry[i].label);
        c->command = g_strdup(command_entry[i].command);
        c->icon_path = uim_toolbar_common_icon_path(self,
                                                    command_entry[i].icon);
        c->show_button = self->show_buttons[i];
        list = g_list_append(list, c);
    }
    return list;
}

void uim_toolbar_command_entry_list_free(GList *list)
{
    for (GList *it = list; it; it = it->next) {
        UimToolbarCommandEntry *c = (UimToolbarCommandEntry *)it->data;
        g_free(c->desc);
        g_free(c->label);
        g_free(c->command);
        g_free(c->icon_path);
        g_free(c);
    }
    g_list_free(list);
}

/* ===== 状態アクセサ ===== */

GList *uim_toolbar_common_branches(UimToolbarCommon *self)
{
    return self->branches;
}

gboolean uim_toolbar_common_is_visible(UimToolbarCommon *self)
{
    return self->is_toolbar_visible;
}

gboolean uim_toolbar_common_is_connected(UimToolbarCommon *self)
{
    return self->is_connected;
}

void uim_toolbar_common_set_state_changed_cb(UimToolbarCommon *self,
                                             void (*cb)(void *user_data),
                                             void *user_data)
{
    self->state_changed_cb = cb;
    self->state_changed_data = user_data;
}

void uim_toolbar_common_set_main_loop(UimToolbarCommon *self,
                                      GMainLoop *loop)
{
    self->main_loop = loop;
}

void uim_toolbar_common_quit(UimToolbarCommon *self)
{
    if (self->main_loop && g_main_loop_is_running(self->main_loop))
        g_main_loop_quit(self->main_loop);
}
