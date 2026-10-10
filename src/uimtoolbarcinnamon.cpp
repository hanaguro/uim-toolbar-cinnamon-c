/* vim: set tabstop=4 shiftwidth=4 softtabstop=4 expandtab: */

/* Cinnamon 版の D-Bus サービス層。
 * LXQt 版 uimtoolbarplugin.{h,cpp}（パネルへプラグインを登録する部分）
 * 相当。Cinnamon アプレット（GJS）は libuim を直接リンクできないため、
 * 常駐プロセスがセッションバスに org.uim.toolbar を公開し、
 * アプレットは D-Bus 経由で状態取得・IM 切り替え・ヘルパー起動を行う。 */

#include "uimtoolbarcinnamon.h"
#include "common-cinnamon.h"

#include <gio/gio.h>
#include <glib.h>
#include <json-glib/json-glib.h>

#define UIM_TOOLBAR_BUS_NAME "org.uim.toolbar"
#define UIM_TOOLBAR_OBJECT_PATH "/org/uim/toolbar"
#define UIM_TOOLBAR_INTERFACE "org.uim.toolbar"

static const char introspection_xml[] =
    "<node>"
    " <interface name='org.uim.toolbar'>"
    "  <method name='GetState'>"
    "   <arg type='s' name='state_json' direction='out'/>"
    "  </method>"
    "  <method name='SwitchIm'>"
    "   <arg type='s' name='action' direction='in'/>"
    "   <arg type='b' name='ok' direction='out'/>"
    "   <arg type='s' name='error' direction='out'/>"
    "  </method>"
    "  <method name='LaunchHelper'>"
    "   <arg type='s' name='command' direction='in'/>"
    "   <arg type='b' name='ok' direction='out'/>"
    "   <arg type='s' name='error' direction='out'/>"
    "  </method>"
    "  <method name='Quit'/>"
    "  <signal name='StateChanged'/>"
    " </interface>"
    "</node>";

struct _UimToolbarCinnamon {
    UimToolbarCommon *common;
    GDBusNodeInfo *node_info;
    GDBusConnection *conn;
    guint registration_id;
    guint owner_id;
};

/* ===== 状態の JSON 化（アプレット側 applet.js でパース） ===== */

static char *state_to_json(UimToolbarCinnamon *self)
{
    JsonObject *root = json_object_new();
    JsonArray *leaves = json_array_new();
    GList *it;

    json_object_set_boolean_member(root, "connected",
                                   uim_toolbar_common_is_connected(self->common));
    json_object_set_boolean_member(root, "visible",
                                   uim_toolbar_common_is_visible(self->common));
    json_object_set_string_member(root, "label",
                                  uim_toolbar_common_branch_label(self->common));
    json_object_set_string_member(root, "tooltip",
                                  uim_toolbar_common_branch_tooltip(self->common));

    char *icon_path = uim_toolbar_common_branch_icon_path(self->common);
    json_object_set_string_member(root, "icon_path", icon_path ? icon_path : "");
    g_free(icon_path);

    for (it = uim_toolbar_common_leaves(self->common); it; it = it->next) {
        UimToolbarPropEntry *e = (UimToolbarPropEntry *)it->data;
        JsonObject *leaf = json_object_new();
        char *leaf_icon = uim_toolbar_common_icon_path(self->common, e->icon);
        json_object_set_string_member(leaf, "label", e->label);
        json_object_set_string_member(leaf, "tooltip", e->tooltip);
        json_object_set_string_member(leaf, "icon_path",
                                      leaf_icon ? leaf_icon : "");
        json_object_set_string_member(leaf, "action", e->action);
        json_object_set_boolean_member(leaf, "selected", e->selected);
        g_free(leaf_icon);
        json_array_add_object_element(leaves, leaf);
    }
    json_object_set_array_member(root, "leaves", leaves);

    /* ツールボタン相当（右クリックメニュー項目） */
    JsonArray *commands = json_array_new();
    GList *clist = uim_toolbar_common_command_entries(self->common);
    for (it = clist; it; it = it->next) {
        UimToolbarCommandEntry *c = (UimToolbarCommandEntry *)it->data;
        JsonObject *cmd = json_object_new();
        json_object_set_string_member(cmd, "desc", c->desc);
        json_object_set_string_member(cmd, "label", c->label ? c->label : "");
        json_object_set_string_member(cmd, "command", c->command);
        json_object_set_string_member(cmd, "icon_path",
                                      c->icon_path ? c->icon_path : "");
        json_array_add_object_element(commands, cmd);
    }
    uim_toolbar_command_entry_list_free(clist);
    json_object_set_array_member(root, "commands", commands);

    JsonNode *root_node = json_node_new(JSON_NODE_OBJECT);
    json_node_take_object(root_node, root);
    char *out = json_to_string(root_node, FALSE); /* g_free 必要 */
    json_node_unref(root_node);
    return out;
}

/* ===== メソッド呼び出し処理 ===== */

static void handle_method_call(GDBusConnection *conn, const char *sender,
                               const char *object_path,
                               const char *interface_name,
                               const char *method_name, GVariant *parameters,
                               GDBusMethodInvocation *invocation,
                               gpointer user_data)
{
    (void)conn;
    (void)sender;
    (void)object_path;
    (void)interface_name;
    UimToolbarCinnamon *self = (UimToolbarCinnamon *)user_data;

    if (!strcmp(method_name, "GetState")) {
        char *json = state_to_json(self);
        g_dbus_method_invocation_return_value(invocation,
                                               g_variant_new("(s)", json));
        g_free(json);
    } else if (!strcmp(method_name, "SwitchIm")) {
        const char *action = NULL;
        g_variant_get(parameters, "(&s)", &action);
        char *error = NULL;
        gboolean ok =
            uim_toolbar_common_activate_action(self->common, action, &error);
        g_dbus_method_invocation_return_value(
            invocation, g_variant_new("(bs)", ok, error ? error : ""));
        g_free(error);
    } else if (!strcmp(method_name, "LaunchHelper")) {
        const char *command = NULL;
        g_variant_get(parameters, "(&s)", &command);
        char *error = NULL;
        gboolean ok =
            uim_toolbar_common_launch_helper(self->common, command, &error);
        g_dbus_method_invocation_return_value(
            invocation, g_variant_new("(bs)", ok, error ? error : ""));
        g_free(error);
    } else if (!strcmp(method_name, "Quit")) {
        g_dbus_method_invocation_return_value(invocation, NULL);
        uim_toolbar_common_quit(self->common);
    }
}

/* ===== 状態変化 → StateChanged シグナル ===== */

static void state_changed_hook(void *user_data)
{
    uim_toolbar_cinnamon_notify_state_changed(
        (UimToolbarCinnamon *)user_data);
}

void uim_toolbar_cinnamon_notify_state_changed(UimToolbarCinnamon *self)
{
    if (!self->conn)
        return;
    g_dbus_connection_emit_signal(self->conn, NULL, UIM_TOOLBAR_OBJECT_PATH,
                                  UIM_TOOLBAR_INTERFACE, "StateChanged", NULL,
                                  NULL);
}

/* ===== バス名取得・インターフェース登録 ===== */

static void on_bus_acquired(GDBusConnection *conn, const gchar *name,
                            gpointer user_data)
{
    UimToolbarCinnamon *self = (UimToolbarCinnamon *)user_data;
    static const GDBusInterfaceVTable vtable = {
        handle_method_call, NULL /* get_property */, NULL /* set_property */};
    GError *error = NULL;

    (void)name;
    self->conn = conn;
    self->registration_id = g_dbus_connection_register_object(
        self->conn, UIM_TOOLBAR_OBJECT_PATH,
        self->node_info->interfaces[0], &vtable, self, NULL, &error);
    if (self->registration_id == 0)
        g_warning("uim-toolbar-cinnamon: failed to register D-Bus interface: %s",
                  error ? error->message : "unknown");
    g_clear_error(&error);
}

static void on_name_acquired(GDBusConnection *conn, const char *name,
                             gpointer user_data)
{
    (void)conn;
    (void)name;
    UimToolbarCinnamon *self = (UimToolbarCinnamon *)user_data;
    g_message("uim-toolbar-cinnamon: acquired bus name %s", name);
    /* 起動直後の初期状態を一度配信する */
    uim_toolbar_cinnamon_notify_state_changed(self);
}

static void on_name_lost(GDBusConnection *conn, const char *name,
                         gpointer user_data)
{
    (void)conn;
    UimToolbarCinnamon *self = (UimToolbarCinnamon *)user_data;
    g_warning("uim-toolbar-cinnamon: lost bus name %s (already running?)",
              name);
    uim_toolbar_common_quit(self->common);
}

/* ===== 生成・開始・破棄 ===== */

UimToolbarCinnamon *uim_toolbar_cinnamon_new(void)
{
    UimToolbarCinnamon *self = g_new0(UimToolbarCinnamon, 1);
    self->common = uim_toolbar_common_new();
    self->node_info = g_dbus_node_info_new_for_xml(
        introspection_xml, NULL);
    if (!self->node_info)
        g_error("uim-toolbar-cinnamon: invalid introspection XML");
    return self;
}

void uim_toolbar_cinnamon_start(UimToolbarCinnamon *self)
{
    uim_toolbar_common_set_state_changed_cb(self->common,
                                            state_changed_hook, self);
    self->owner_id = g_bus_own_name(G_BUS_TYPE_SESSION, UIM_TOOLBAR_BUS_NAME,
                                    G_BUS_NAME_OWNER_FLAGS_NONE, on_bus_acquired,
                                    on_name_acquired, on_name_lost, self, NULL);
    uim_toolbar_common_connect(self->common);
}

void uim_toolbar_cinnamon_free(UimToolbarCinnamon *self)
{
    if (!self)
        return;
    if (self->registration_id)
        g_dbus_connection_unregister_object(self->conn, self->registration_id);
    if (self->owner_id)
        g_bus_unown_name(self->owner_id);
    if (self->node_info)
        g_dbus_node_info_unref(self->node_info);
    uim_toolbar_common_free(self->common);
    g_free(self);
}

UimToolbarCommon *uim_toolbar_cinnamon_common(UimToolbarCinnamon *self)
{
    return self->common;
}
