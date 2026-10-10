/* uim-toolbar@cinnamon.org
 *
 * Cinnamon パネル用 uim ツールバーアプレット。
 * LXQt 版 (uim-toolbar-qt6-lxqtwidget) と同じ仕様だが、GJS から libuim を
 * 直接リンクできないため、状態取得・IM 切り替え・ヘルパー起動は
 * 常駐プロセス uim-toolbar-cinnamon が提供する D-Bus サービス
 * org.uim.toolbar 経由で行う。
 */

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const PanelApplet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;

const BUS_NAME = 'org.uim.toolbar';
const OBJECT_PATH = '/org/uim/toolbar';
const INTERFACE_NAME = 'org.uim.toolbar';
const DAEMON_COMMAND = 'uim-toolbar-cinnamon';

class UimToolbarApplet extends PanelApplet.TextIconApplet {
    constructor(orientation, panel_height, instance_id) {
        super(orientation, panel_height, instance_id);

        this._state = null;
        this._menuItems = [];

        this.set_applet_label('uim');
        this.set_applet_tooltip('uim');
        this.set_applet_icon_symbolic_name('input-keyboard');

        /* 左クリック: IM 選択メニュー */
        this.menu = new PanelApplet.AppletPopupMenu(this, orientation);
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menuManager.addMenu(this.menu);

        /* 右クリック: ヘルパー起動メニュー（GTK3 版右クリックメニュー相当）
         * Cinnamon の PopupMenuBase には 'open' シグナルが無いので
         * finalizeContextMenu をオーバーライドして構築する
         * （appletManager が main() 直後に 1 回呼ぶ）。
         * super を呼ぶことで "About..."/"Remove" も自動追加される。 */

        /* D-Bus プロキシ（常駐プロセスが居なければ起動を試みる） */
        try {
            this._proxy = Gio.DBusProxy.new_for_bus_sync(
                Gio.BusType.SESSION,
                Gio.DBusProxyFlags.NONE,
                null,
                BUS_NAME,
                OBJECT_PATH,
                INTERFACE_NAME,
                null);
        } catch (e) {
            global.logError('uim-toolbar: proxy init failed: ' + e.message);
            this._proxy = null;
        }
        if (this._proxy) {
            this._proxy.connect('notify::g-name-owner', () => {
                /* 常駐プロセスが落ちたら再起動する */
                if (!this._proxy.g_name_owner)
                    this._ensureDaemon();
                this._refresh();
            });
            this._proxy.connect('g-signal',
                (proxy, senderName, signalName, params) => {
                    if (signalName === 'StateChanged')
                        this._refresh();
                });
        }
    }

    /* ===== D-Bus ===== */

    on_applet_added_to_panel() {
        if (this._proxy && !this._proxy.g_name_owner)
            this._ensureDaemon();
        this._refresh();
    }

    _ensureDaemon() {
        try {
            let subprocess = Gio.Subprocess.new([DAEMON_COMMAND],
                                                 Gio.SubprocessFlags.NONE);
            subprocess.wait_async(null, (proc, res) => {
                try {
                    proc.wait_finish(res);
                } catch (e) {
                    /* 常駐なので終了しないはず。失敗したなら何もしない */
                }
            });
        } catch (e) {
            global.logError('uim-toolbar: failed to launch ' +
                            DAEMON_COMMAND + ': ' + e.message);
        }
    }

    _callSync(method, params) {
        if (!this._proxy || !this._proxy.g_name_owner)
            return null;
        try {
            return this._proxy.call_sync(method, params,
                                         Gio.DBusCallFlags.NONE, -1, null);
        } catch (e) {
            global.logError('uim-toolbar: ' + method + ' failed: ' +
                            e.message);
            return null;
        }
    }

    /* ===== 状態取得・表示 ===== */

    _refresh() {
        let reply = this._callSync('GetState', null);
        if (!reply)
            return;
        /* GetState の戻り値は (s)。unpack() の要素は GLib.Variant なので
         * get_string() で JS 文字列にする */
        let json = reply.unpack()[0].get_string()[0];
        try {
            this._state = JSON.parse(json);
        } catch (e) {
            global.logError('uim-toolbar: bad state JSON: ' + e.message);
            return;
        }
        this._updateDisplay();
    }

    _updateDisplay() {
        let state = this._state;
        if (!state)
            return;

        this.actor.visible = !!state.visible;

        this.set_applet_label(state.label);
        this.set_applet_tooltip(state.tooltip || state.label);

        /* uim がアイコンファイルを渡す場合はパス指定アイコン、
         * 無ければシンボリックのキーボードアイコン */
        if (state.icon_path) {
            this.set_applet_icon_path(state.icon_path);
        } else {
            this.set_applet_icon_symbolic_name('input-keyboard');
        }
    }

    /* ===== 左クリック: IM 選択メニュー ===== */

    on_applet_clicked(event) {
        this._buildImMenu();
        this.menu.toggle();
    }

    _buildImMenu() {
        this.menu.removeAll();
        this._menuItems = [];

        let state = this._state;
        if (!state || !state.connected || !state.leaves ||
            state.leaves.length === 0) {
            let item = new PopupMenu.PopupMenuItem(
                (state && !state.connected) ? 'uim-helper 未接続' : 'uim');
            item.set_sensitive(false);
            this.menu.addMenuItem(item);
            return;
        }

        for (let i = 0; i < state.leaves.length; i++) {
            let leaf = state.leaves[i];
            /* Cinnamon の popupMenu.js に PopupRadioMenuItem は無い。
             * PopupMenuItem + setOrnament(DOT) が Cinnamon 流儀 */
            let item = new PopupMenu.PopupMenuItem(leaf.label);
            item.setOrnament(PopupMenu.OrnamentType.DOT, leaf.selected);
            if (leaf.tooltip)
                item.label.set_tooltip_text(leaf.tooltip);
            item.action = leaf.action;
            item.connect('activate', (menuItem) => {
                this._callSync('SwitchIm',
                               new GLib.Variant('(s)', [menuItem.action]));
            });
            this.menu.addMenuItem(item);
            this._menuItems.push(item);
        }
    }

    /* ===== 右クリック: ヘルパー起動メニュー ===== */

    /* appletManager が main() 直後に 1 回呼ぶ。ここでヘルパー起動項目を
     * 追加してから super を呼ぶと、Cinnamon 既定の "About..."/"Remove"
     * も自動で追加される。 */
    finalizeContextMenu() {
        this._buildContextMenu();
        PanelApplet.TextIconApplet.prototype.finalizeContextMenu.call(this);
    }

    /* 右クリックのたびにメニューを最新の状態（GetState 結果）から
     * 作り直す。super._onButtonPressEvent が button 3 で
     * _applet_context_menu を開く。 */
    _onButtonPressEvent(actor, event) {
        if (event.get_button() === 3) {
            this._applet_context_menu.removeAll();
            this._buildContextMenu();
            PanelApplet.TextIconApplet.prototype.finalizeContextMenu.call(this);
        }
        return PanelApplet.TextIconApplet.prototype._onButtonPressEvent.call(this, actor, event);
    }

    _buildContextMenu() {
        this._applet_context_menu.removeAll();

        let state = this._state;
        if (state && state.commands) {
            for (let i = 0; i < state.commands.length; i++) {
                let cmd = state.commands[i];
                let item = new PopupMenu.PopupMenuItem(cmd.desc);
                item.connect('activate', () => {
                    this._callSync('LaunchHelper',
                                   new GLib.Variant('(s)', [cmd.command]));
                });
                this._applet_context_menu.addMenuItem(item);
            }
        }

        this._applet_context_menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem());
        let quitItem = new PopupMenu.PopupMenuItem('ツールバーを終了');
        quitItem.connect('activate', () => {
            this._callSync('Quit', null);
        });
        this._applet_context_menu.addMenuItem(quitItem);
    }

    /* ===== 生命周期 ===== */

    on_applet_removed_from_panel() {
        if (this._proxy)
            this._proxy.run_dispose();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new UimToolbarApplet(orientation, panel_height, instance_id);
}
