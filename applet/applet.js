/* uim-toolbar@cinnamon.org
 *
 * Cinnamon パネル用 uim ツールバーアプレット。
 * LXQt 版 (uim-toolbar-qt6-lxqtwidget) と同じ仕様だが、GJS から libuim を
 * 直接リンクできないため、状態取得・IM 切り替え・ヘルパー起動は
 * 常駐プロセス uim-toolbar-cinnamon が提供する D-Bus サービス
 * org.uim.toolbar 経由で行う。
 */

const Cinnamon = imports.gi.Cinnamon;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Lang = imports.lang;
const Main = imports.ui.main;
const PanelApplet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const St = imports.gi.St;
const Mainloop = imports.mainloop;

const BUS_NAME = 'org.uim.toolbar';
const OBJECT_PATH = '/org/uim/toolbar';
const INTERFACE_NAME = 'org.uim.toolbar';
const DAEMON_COMMAND = 'uim-toolbar-cinnamon';

function UimToolbarApplet(orientation, panel_height, instance_id) {
    this._init(orientation, panel_height, instance_id);
}

UimToolbarApplet.prototype = {
    __proto__: PanelApplet.TextIconApplet.prototype,

    _init: function(orientation, panel_height, instance_id) {
        PanelApplet.TextIconApplet.prototype._init.call(this, orientation,
                                                        panel_height,
                                                        instance_id);

        this._state = null;
        this._menuItems = [];

        /* 左クリック: IM 選択メニュー */
        this.menu = new PanelApplet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);

        /* D-Bus プロキシ（常駐プロセスが居なければ起動を試みる） */
        this._proxy = new Gio.DBusProxy({
            g_bus_type: Gio.BusType.SESSION,
            g_name: BUS_NAME,
            g_object_path: OBJECT_PATH,
            g_interface_name: INTERFACE_NAME,
            g_flags: Gio.DBusProxyFlags.NONE,
        });
        this._proxy.init_async(GLib.PRIORITY_DEFAULT, null,
                               Lang.bind(this, this._onProxyInit));
        this._proxy.connect('g-properties-changed',
                            Lang.bind(this, this._onNameOwnerChanged));
        this._proxy.connect('g-signal',
                            Lang.bind(this, this._onSignal));

        this.set_app_label('uim');
    },

    /* ===== D-Bus ===== */

    _onProxyInit: function(proxy, result) {
        try {
            proxy.init_finish(result);
        } catch (e) {
            global.logError('uim-toolbar: proxy init failed: ' + e.message);
        }
        if (!proxy.g_name_owner)
            this._ensureDaemon();
        this._refresh();
    },

    _onNameOwnerChanged: function(proxy) {
        /* 常駐プロセスが落ちたら再起動する */
        if (!proxy.g_name_owner)
            this._ensureDaemon();
        this._refresh();
    },

    _onSignal: function(proxy, senderName, signalName, params) {
        if (signalName === 'StateChanged')
            this._refresh();
    },

    _ensureDaemon: function() {
        try {
            let subprocess = Gio.Subprocess.new([DAEMON_COMMAND],
                                                 Gio.SubprocessFlags.NONE);
            subprocess.wait_async(null, Lang.bind(this, function(proc, res) {
                try {
                    proc.wait_finish(res);
                } catch (e) {
                    /* 常駐なので終了しないはず。失敗したなら何もしない */
                }
            }));
        } catch (e) {
            global.logError('uim-toolbar: failed to launch ' +
                            DAEMON_COMMAND + ': ' + e.message);
        }
    },

    _callSync: function(method, params) {
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
    },

    /* ===== 状態取得・表示 ===== */

    _refresh: function() {
        let reply = this._callSync('GetState', null);
        if (!reply)
            return;
        let json = reply.get_child(0).get_string()[0];
        try {
            this._state = JSON.parse(json);
        } catch (e) {
            global.logError('uim-toolbar: bad state JSON: ' + e.message);
            return;
        }
        this._updateDisplay();
    },

    _updateDisplay: function() {
        let state = this._state;
        if (!state)
            return;

        if (!state.visible) {
            this.actor.visible = false;
            return;
        }
        this.actor.visible = true;

        this.set_app_label(state.label);
        this.set_app_tooltip(state.tooltip || state.label);

        /* アイコンファイルがあればアイコン表示、無ければラベル表示 */
        if (state.icon_path) {
            try {
                let file = Gio.File.new_for_path(state.icon_path);
                let icon = new Gio.FileIcon({ file: file });
                if (!this._iconActor) {
                    this._iconActor = new St.Icon({
                        gicon: icon,
                        icon_size: 16,
                    });
                    this._iconActor.visible = true;
                    this.set_app_icon(this._iconActor);
                } else {
                    this._iconActor.gicon = icon;
                }
            } catch (e) {
                /* アイコン読み込み失敗時はラベルのみ */
            }
        }
    },

    /* ===== 左クリック: IM 選択メニュー ===== */

    on_applet_clicked: function(event) {
        this._buildImMenu();
        this.menu.toggle();
    },

    _buildImMenu: function() {
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
            let item = new PopupMenu.PopupRadioMenuItem(leaf.label,
                                                        leaf.selected);
            if (leaf.tooltip)
                item.label.set_tooltip_text(leaf.tooltip);
            item.action = leaf.action;
            item.connect('activate', Lang.bind(this, function(menuItem) {
                this._callSync('SwitchIm',
                               GLib.Variant.new('(s)', [menuItem.action]));
            }));
            this.menu.addMenuItem(item);
            this._menuItems.push(item);
        }
    },

    /* ===== 右クリック: ヘルパー起動メニュー（GTK3 版右クリックメニュー相当） ===== */

    _buildContextMenu: function() {
        this._applet_context_menu.removeAll();

        let state = this._state;
        if (state && state.commands) {
            for (let i = 0; i < state.commands.length; i++) {
                let cmd = state.commands[i];
                let item = new PopupMenu.PopupMenuItem(cmd.desc);
                item.connect('activate', Lang.bind(this, function() {
                    this._callSync('LaunchHelper',
                                   GLib.Variant.new('(s)', [cmd.command]));
                }));
                this._applet_context_menu.addMenuItem(item);
            }
        }

        this._applet_context_menu.addMenuItem(
            new PopupMenu.PopupSeparatorMenuItem());
        let quitItem = new PopupMenu.PopupMenuItem('ツールバーを終了');
        quitItem.connect('activate', Lang.bind(this, function() {
            this._callSync('Quit', null);
        }));
        this._applet_context_menu.addMenuItem(quitItem);
    },

    on_applet_context_menu_open: function() {
        this._buildContextMenu();
    },

    /* ===== 生命周期 ===== */

    on_applet_removed_from_panel: function() {
        if (this._proxy)
            this._proxy.run_dispose();
    },
};

function main(metadata, orientation, panel_height, instance_id) {
    return new UimToolbarApplet(orientation, panel_height, instance_id);
}
