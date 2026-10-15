/* vim: set tabstop=4 shiftwidth=4 softtabstop=4 expandtab: */
#pragma once

#include <glib.h>

#ifdef __cplusplus
extern "C" {
#endif

/* uim helper 接続と prop_list_update 状態管理。
 * GTK3 ツールバー common-gtk.c の UI 部分を Cinnamon アプレットへ移し、
 * helper 接続・メッセージ解析・prop_activate 送信のみを担う。 */

typedef struct _UimToolbarPropEntry {
    char *label;    /* 表示ラベル（label） */
    char *tooltip;  /* ツールチップ */
    char *icon;     /* アイコン名（indication_id; uim pixmaps 名） */
    char *action;   /* 送信する action（action_imsw_<im> 等） */
    gboolean selected; /* 選択状態（state == "*"） */
} UimToolbarPropEntry;

/* prop_list_update の branch 行ごとの枝（インジケータ）グループ。
 * branch 行 1 本 = 「現在の状態表示」1 つとその切替項目 leaves。
 * GTK3 版は branch 行ごとに prop_button を作る（複数来れば buttons も複数。
 * 例: SKK なら [IM 切替][入力モード][ローマ字] の 3 グループ） */
typedef struct _UimToolbarBranch {
    char *label;   /* branch 行の iconic_label（ボタン表示） */
    char *tooltip; /* branch 行の description（ツールチップ） */
    char *icon;    /* indication_id（uim pixmaps 名） */
    GList *leaves; /* UimToolbarPropEntry* */
} UimToolbarBranch;

typedef struct _UimToolbarCommandEntry {
    char *desc;        /* 表示名 */
    char *label;       /* テキストラベル（アイコンが無い項目用） */
    char *command;     /* 起動コマンド（uim-pref-gtk3 等） */
    char *icon_path;   /* /usr/share/uim/pixmaps 配下の png（無ければ NULL） */
    gboolean show_button; /* toolbar-show-*-button? が真（インラインボタン表示） */
} UimToolbarCommandEntry;

typedef struct _UimToolbarCommon UimToolbarCommon;

UimToolbarCommon *uim_toolbar_common_new(void);
void uim_toolbar_common_free(UimToolbarCommon *self);

/* helper 接続開始（切断時は 1 秒後に再接続） */
void uim_toolbar_common_connect(UimToolbarCommon *self);

/* 現在の状態。枝リストは helper プロトコルの出現順（先頭 = IM グループ）*/
GList *uim_toolbar_common_branches(UimToolbarCommon *self); /* const UimToolbarBranch* */
gboolean uim_toolbar_common_is_visible(UimToolbarCommon *self);
gboolean uim_toolbar_common_is_connected(UimToolbarCommon *self);

/* アイコンファイルパス解決（GTK3 版 register_icon と同じ
 * <pixmaps>/<name>[_dark_background].png 規則。無ければ NULL） */
char *uim_toolbar_common_icon_path(UimToolbarCommon *self, const char *name);

/* 選択系 action（leaf の activate）を送信する。
 * GTK3 版と同様、action_imsw_* かつ imsw-coverage == system-global なら
 * custom-preserved-default-im-name を保存する。 */
gboolean uim_toolbar_common_activate_action(UimToolbarCommon *self,
                                            const char *action,
                                            char **error);

/* ヘルパーアプリ（uim-pref-gtk3 等）を起動する */
gboolean uim_toolbar_common_launch_helper(UimToolbarCommon *self,
                                          const char *command,
                                          char **error);
const char *uim_toolbar_common_helper_command(UimToolbarCommon *self,
                                              const char *desc);

/* ヘルパー起動項目の全リスト（インラインツールボタン相当。
 * show_button フラグが toolbar-show-*-button? に対応し、
 * アプレット側でツールバー本体内に並べるか判定するのに使う） */
GList *uim_toolbar_common_command_entries(UimToolbarCommon *self);
void uim_toolbar_command_entry_list_free(GList *list);

/* 状態変化（prop_list_update 解析完了）時の通知フック */
void uim_toolbar_common_set_state_changed_cb(UimToolbarCommon *self,
                                             void (*cb)(void *user_data),
                                             void *user_data);

/* 常駐プロセスのメインループ（「終了」メニュー用） */
void uim_toolbar_common_set_main_loop(UimToolbarCommon *self,
                                      GMainLoop *loop);
void uim_toolbar_common_quit(UimToolbarCommon *self);

#ifdef __cplusplus
}
#endif
