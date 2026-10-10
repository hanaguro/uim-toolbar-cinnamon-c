/* vim: set tabstop=4 shiftwidth=4 softtabstop=4 expandtab: */

/* uim-toolbar-cinnamon 常駐プロセスの入口。
 * LXQt 版では uimtoolbarwidget.cpp（プラグインウィジェット）が
 * uim_init() と gettext 初期化を行っていたが、Cinnamon では GJS アプレットが
 * libuim を直接扱えないため、本バイナリが常駐して
 * D-Bus サービス org.uim.toolbar を提供する。 */

#include "uimtoolbarcinnamon.h"
#include "common-cinnamon.h"

#include <glib.h>

#include <clocale>   // setlocale
#include <libintl.h> // bindtextdomain, bind_textdomain_codeset
#include <config.h>  // PACKAGE, GETTEXT_PACKAGE, LOCALEDIR などのマクロ

#include <uim/uim.h>

int main(int argc, char *argv[])
{
    (void)argc;
    (void)argv;

    setlocale(LC_ALL, "");
    bindtextdomain(GETTEXT_PACKAGE, LOCALEDIR);
    bind_textdomain_codeset(GETTEXT_PACKAGE, "UTF-8");

    /* uim_init() は成功時 OK(0)、失敗時 FAILED(-1) を返す。
     * 参考実装（standalone-gtk.c / LXQt 版）も戻り値をチェックしていない。 */
    if (uim_init() < 0) {
        g_set_prgname("uim-toolbar-cinnamon");
        g_message("uim-toolbar-cinnamon: uim_init() failed");
        return 1;
    }

    GMainLoop *loop = g_main_loop_new(NULL, FALSE);

    UimToolbarCinnamon *toolbar = uim_toolbar_cinnamon_new();
    uim_toolbar_common_set_main_loop(uim_toolbar_cinnamon_common(toolbar),
                                     loop);
    uim_toolbar_cinnamon_start(toolbar);

    g_main_loop_run(loop);

    uim_toolbar_cinnamon_free(toolbar);
    g_main_loop_unref(loop);
    uim_quit();
    return 0;
}
