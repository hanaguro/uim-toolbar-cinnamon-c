/* vim: set tabstop=4 shiftwidth=4 softtabstop=4 expandtab: */
#pragma once

/* Cinnamon 版: LXQt 版の uimtoolbarplugin.{h,cpp}（パネルプラグイン登録）
 * 相当。Cinnamon アプレット（GJS）は libuim を直接リンクできないため、
 * uim helper との接続・状態管理を担う常駐プロセスとして
 * D-Bus サービス org.uim.toolbar を提供する。 */

typedef struct _UimToolbarCommon UimToolbarCommon;

typedef struct _UimToolbarCinnamon UimToolbarCinnamon;

UimToolbarCinnamon *uim_toolbar_cinnamon_new(void);
void uim_toolbar_cinnamon_start(UimToolbarCinnamon *self);
void uim_toolbar_cinnamon_free(UimToolbarCinnamon *self);

UimToolbarCommon *uim_toolbar_cinnamon_common(UimToolbarCinnamon *self);
void uim_toolbar_cinnamon_notify_state_changed(UimToolbarCinnamon *self);
