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
const St = imports.gi.St;
const Main = imports.ui.main;
const ByteArray = imports.byteArray;
const PanelApplet = imports.ui.applet;
const PopupMenu = imports.ui.popupMenu;
const Tooltips = imports.ui.tooltips;

/* options.json で調整する既定値（reference 実装 uim-toolbar@hanaguro-port と
 * 同じ単位系: アイコンは iconSize(px)、ボタン枠は min-width/min-height
 * （buttonSize px の正方形）で描画する。パネルのアイコンサイズ設定には
 * 追従しない）。 */
const DEFAULT_OPTIONS = {iconSize: 16, buttonSize: 26};

const BUS_NAME = 'org.uim.toolbar';
const OBJECT_PATH = '/org/uim/toolbar';
const INTERFACE_NAME = 'org.uim.toolbar';
const DAEMON_COMMAND = 'uim-toolbar-cinnamon';

/* インラインツールボタンのアイコン。/usr/share/uim/pixmaps に PNG が
 * 無い項目（preferences/input_pad/handwriting/help）はテーマの
 * シンボリックアイコンで代替する（GTK3 版は同一 png 前提のため、
 * 無い項目はピクセル表示が崩れる。reference 実装と同じ対応）。
 * 何も無いときのためのテキスト代替（label）は JSON 側に含む。 */
const TOOL_SYMBOLIC_ICONS = {
    'uim-im-switcher-gtk3': 'input-keyboard',
    'uim-pref-gtk3': 'preferences-system',
    'uim-dict-gtk3': 'accessories-dictionary',
    'uim-input-pad-ja-gtk3': 'format-text-bold',
    'uim-tomoe-gtk': 'document-edit',
    'uim-help': 'help-contents',
};

class UimToolbarApplet extends PanelApplet.TextIconApplet {
    constructor(orientation, panel_height, instance_id, metadata) {
        super(orientation, panel_height, instance_id);

        this._state = null;
        this._menuItems = [];
        this._orientation = orientation;
        this._pendingRefresh = false;
        this._branchButtons = []; /* branch[1..] 分の表示ボタン（St.Button） */
        this._branchMenus = [];   /* 上記ボタン用の PopupMenu（uiGroup 側） */
        this._toolButtons = [];  /* インラインツールボタン（St.Button） */
        this._mainButton = null; /* メイン表示用ボタン（左クリックで IM メニュー） */
        this._mainBin = null;    /* _applet_icon/_applet_label を入れておく箱 */

        /* 常駐バイナリはアプレットと同じディレクトリに同梱される
         * （/usr/bin 等には依存しない。~/.cinnamon にコピーした場合も
         * metadata.path がコピー先を指すのでそのまま動く） */
        this._daemonPath = GLib.build_filenamev(
            [metadata.path, DAEMON_COMMAND]);
        this._loadOptions(metadata.path);

        /* 未接続時の初期表示はテキストのみ（GTK3 版の branch ラベル相当）。
         * 接続後は uim のアイコン表示に切り替える */
        this.set_applet_label('uim');
        this.set_applet_tooltip('uim');
        /* ツールボタンと隙間無く並べる（reference と同じ） */
        this.actor.style = 'spacing: 0px;';

        /* 左クリック: IM 選択メニュー。
         * AppletPopupMenu にしないこと。source actor が actor 全体
         * （= ブランチボタンを含む）になると、開いている間に他ボタン
         * 上リリースが manager に「active menu の source 内」と見なされ
         * 通過して二重オープン → pushModal grab 不整合 → フリーズする。
         * reference 同様 actor を専有する専用 St.Button（_ensureMainButton
         * で生成）を source にする。menu 自体は _ensureMainButton 内にて */
        this.menu = null;
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this._applet_context_menu.connect('open-state-changed',
            (m, open) => { if (!open) this._flushPendingRefresh(); });

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

    /* ===== 設定（options.json） ===== */

    _loadOptions(path) {
        this._options = Object.assign({}, DEFAULT_OPTIONS);
        try {
            let file = Gio.File.new_for_path(GLib.build_filenamev(
                [path, 'options.json']));
            let [ok, data] = file.load_contents(null);
            if (ok)
                Object.assign(this._options,
                              JSON.parse(ByteArray.toString(data)));
        } catch (e) {
            /* options.json が無い/読めない場合は既定値で動く */
        }
        this._options.iconSize = Math.max(8, Math.min(64,
            Number(this._options.iconSize) || DEFAULT_OPTIONS.iconSize));
        this._options.buttonSize = Math.max(
            this._options.iconSize,
            Math.min(80, Number(this._options.buttonSize) ||
                       DEFAULT_OPTIONS.buttonSize));
    }

    _buttonStyle() {
        let s = this._options.buttonSize;
        return 'min-width: ' + s + 'px; min-height: ' + s + 'px;';
    }

    /* ===== D-Bus ===== */

    on_applet_added_to_panel() {
        if (this._proxy && !this._proxy.g_name_owner)
            this._ensureDaemon();
        this._refresh();
    }

    _ensureDaemon() {
        try {
            let subprocess = Gio.Subprocess.new([this._daemonPath],
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
                            this._daemonPath + ': ' + e.message);
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

    _hasOpenMenu() {
        if (this.menu && this.menu.isOpen)
            return true;
        if (this._applet_context_menu && this._applet_context_menu.isOpen)
            return true;
        for (let m of this._branchMenus) {
            if (m.isOpen)
                return true;
        }
        return false;
    }

    _flushPendingRefresh() {
        if (this._pendingRefresh && !this._hasOpenMenu()) {
            this._pendingRefresh = false;
            this._refresh();
        }
    }

    /* 開いているメニューを全て閉じる。返り値は「閉じるものが有ったか」。
     * Cinnamon の PopupMenuManager は pushModal の排他 grab を
     * 「オーナーにつき active メニュー 1 つ = grab 1 回」前提で追うため、
     * 開いたまま別のメニューを toggle/close で直接操作すると ungrab が
     * スキップされて modal が残留しデスクトップごとフリーズする。
     * よって「他のメニューが開いているクリックでは絶対に開かない」
     * （= GTK3 ツールバーと同じ動作）をアプリ側で保証する */
    _dismissOpenMenus() {
        let closed = false;
        if (this.menu && this.menu.isOpen) {
            this.menu.close();
            closed = true;
        }
        for (let m of this._branchMenus) {
            if (m.isOpen) {
                m.close();
                closed = true;
            }
        }
        return closed;
    }

    _refresh() {
        if (this._hasOpenMenu()) {
            this._pendingRefresh = true;
            return;
        }
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

        /* branch 行ごとに 1 ボタン（GTK3 版 common-gtk.c が branch ごとに
         * prop_button を作るのと同じ。SKK なら [Sk][あ][Ｒ] の 3 ボタン）。
         * 先頭枝（IM 切り替え表示）を TextIconApplet 本体表示に使い、
         * 2 番目以降の枝は _buildBranchButtons() で隣に並べる。
         * branches が無い古い GetState ならトップレベルフィールドへ退化 */
        let main = (state.branches && state.branches.length)
            ? state.branches[0] : null;
        let label = main ? main.label : state.label;
        let tooltip = main ? main.tooltip : state.tooltip;
        let iconPath = main ? main.icon_path : state.icon_path;

        this._ensureMainButton();
        if (this._mainTip)
            this._mainTip.set_text(tooltip || label);

        /* uim ツールバー（GTK3/LXQt 版）と同じ表示規則:
         * uim がアイコンファイルを渡す場合はアイコンのみを表示し、
         * テキストラベルは非表示にする。アイコンファイルが無いときだけ
         * 代替としてテキスト（iconic label）を表示する */
        if (iconPath) {
            this.set_applet_icon_path(iconPath);
            this._setIconSize();
            this._applet_icon.visible = true;
            this.set_applet_label('');
        } else {
            if (this._applet_icon)
                this._applet_icon.hide();
            this.set_applet_label(label);
        }
        this._buildBranchButtons(state);
        this._buildToolButtons(state);
    }

    /* branch[1..]: 枝分组ごとの表示ボタン（入力モード等）。
     * 各ボタンは個別の PopupMenu を持ちクリックで開く
     * （reference 実装の _addBranch / GTK3 版の prop_button と同じ）。 */
    _buildBranchButtons(state) {
        for (let m of this._branchMenus) {
            m.destroy();
        }
        for (let b of this._branchButtons)
            b.destroy();
        this._branchMenus = [];
        this._branchButtons = [];

        if (!state.branches || state.branches.length < 2)
            return;

        for (let i = 1; i < state.branches.length; i++) {
            let branch = state.branches[i];

            let button = new St.Button({
                reactive: true,
                button_mask: St.ButtonMask.ONE,
                track_hover: true,
                can_focus: true,
                style_class: 'uim-toolbar-button',
                style: this._buttonStyle(),
            });
            if (branch.icon_path) {
                button.set_child(new St.Icon({
                    gicon: Gio.FileIcon.new(Gio.File.new_for_path(
                        branch.icon_path)),
                    icon_type: St.IconType.FULLCOLOR,
                    icon_size: this._toolIconSize(),
                }));
            } else {
                button.set_child(new St.Label({
                    text: branch.label || '?',
                    style_class: 'uim-toolbar-button-label',
                }));
            }
            new Tooltips.Tooltip(button, branch.tooltip || branch.label);

            let menu = this._makeBranchMenu(button, branch);
            button.connect('clicked', () => {
                /* 他に開いているメニューがあれば第一段階のクリックは
                 * 閉じるだけ（GTK3 版と同じ）。menu の actor を source に
                 * 持つこのクリックは manager に消費されずにここまで届く
                 * （sourceActor.contains() 判定）ので、トグルすると
                 * grab 不整合でフリーズする */
                if (this._dismissOpenMenus())
                    return;
                menu.toggle();
            });

            this.actor.add(button, {y_align: St.Align.MIDDLE,
                                    y_fill: false});
            this._branchButtons.push(button);
            this._branchMenus.push(menu);
        }
    }

    _makeBranchMenu(sourceActor, branch) {
        let menu = new PopupMenu.PopupMenu(sourceActor, this._orientation);
        Main.uiGroup.add_actor(menu.actor);
        menu.actor.hide();
        /* PopupMenuManager は actor の子ではなく sourceActor の
         * enter-event で開く仕組みではないので、open 状態の一元管理は
         * manager 側（this.menuManager が全メニューを把握）に任せる。
         * manager.addMenu するとアクティブメニューの grab 管理等が
         * Cinnamon 既定動作に従うようになる */
        this.menuManager.addMenu(menu);
        menu.connect('open-state-changed',
            (m, open) => { if (!open) this._flushPendingRefresh(); });

        for (let leaf of (branch.leaves || [])) {
            let item = new PopupMenu.PopupMenuItem(leaf.label);
            if (leaf.icon_path) {
                let icon = new St.Icon({
                    gicon: Gio.FileIcon.new(Gio.File.new_for_path(
                        leaf.icon_path)),
                    icon_type: St.IconType.FULLCOLOR,
                    icon_size: this._options.iconSize,
                });
                item.addActor(icon, {span: 0});
            }
            item.setOrnament(PopupMenu.OrnamentType.DOT, leaf.selected);
            /* Cinnamon の St.Label に set_tooltip_text は無い。
             * リファレンス同様 PopupMenuItem.actor へ Tooltip をアタッチ。
             * メニュー破棄時に actor も破棄され Tooltip も GC される */
            if (leaf.tooltip)
                new Tooltips.Tooltip(item.actor, leaf.tooltip);
            item.action = leaf.action;
            item.connect('activate', (menuItem) => {
                this._callSync('SwitchIm',
                               new GLib.Variant('(s)', [menuItem.action]));
            });
            menu.addMenuItem(item);
        }
        return menu;
    }

    /* ===== ツールバー本体の組み立て =====
     * TextIconApplet の icon/label（actor の子をそのまま流用）を
     * St.Button で包み、その隣に toolbar-show-*-button? が真の
     * インラインツールボタンを並べる（GTK3 版で main button の後に
     * append_tool_button するのと同じ並び順）。 */

    _ensureMainButton() {
        if (this._mainButton)
            return;

        /* 基底 TextIconApplet が actor (St.BoxLayout) に直接置いてる
         * アイコン側 _applet_icon_box と ラベル側 _layoutBin を横向きの箱へ
         * 移し、それを St.Button で包む。移し替え後 actor は空になるので
         * ボタンを最初に追加すれば並び順は変わらない
         * （St.BoxLayout に get_child() は無いので子参照で移動しないこと）*/
        this._mainBin = new St.BoxLayout();

        for (let child of [this._applet_icon_box, this._layoutBin]) {
            let parent = child.get_parent();
            if (parent)
                parent.remove_child(child);
        }
        this._mainBin.add(this._applet_icon_box);
        this._mainBin.add(this._layoutBin, {y_align: St.Align.MIDDLE,
                                            y_fill: false});

        /* button_mask は既定で left のみ。右クリックはボタンが処理せずに
         * actor へバブルするので、基底の _onButtonPressEvent
         * （右クリックで context menu）がそのまま扱う。
         * ボタン枠（buttonSize px の正方形・hover 背景）は
         * reference 実装 uim-toolbar@hanaguro-port と同じ */
        this._mainButton = new St.Button({
            reactive: true,
            track_hover: true,
            can_focus: true,
            child: this._mainBin,
            style_class: 'uim-toolbar-button',
            style: this._buttonStyle(),
        });

        /* ブランチメニューと同じ流儀: source = この専用ボタンのみ。
         * actor は uiGroup に直置きで非表示（AppletPopupMenu 相当） */
        this.menu = new PopupMenu.PopupMenu(this._mainButton,
                                            this._orientation);
        Main.uiGroup.add_actor(this.menu.actor);
        this.menu.actor.hide();
        this.menuManager.addMenu(this.menu);
        /* メニュー表示中の StateChanged は source actor 再作成に繋がる
         * ので、閉じるまで遅らせる（reference の _renderWhenSafe 相当；
         * ブランチメニュー側は _makeBranchMenu で同様の接続済み） */
        this.menu.connect('open-state-changed',
            (m, open) => { if (!open) this._flushPendingRefresh(); });

        this._mainButton.connect('clicked', () => {
            /* ブランチボタン側と同じ開閉方針: 何かが開いているクリックは
             * 閉じるだけ（GTK3 版と同じ）。何も開いていなければトグルで開く */
            if (this._dismissOpenMenus())
                return;
            this._buildImMenu();
            this.menu.toggle();
        });

        /* actor 全体を覆うボタンを置くので、基底の actor 用ツールチップは
         * 無効化してボタン用のツールチップに置き換える
         * （ツールボタン側と同じ位置に出るようにするため） */
        this._applet_tooltip.preventShow = true;
        this._mainTip = new Tooltips.Tooltip(this._mainButton, 'uim');

        this.actor.add(this._mainButton, {y_align: St.Align.MIDDLE,
                                          y_fill: false});
    }

    /* 基底 IconApplet は set_applet_icon_path 時にパネルのアイコンサイズを
     * 適用するので、options.json の iconSize を最後に上書きする */
    _setIconSize() {
        if (this._applet_icon)
            this._applet_icon.set_icon_size(this._options.iconSize);
    }

    /* パネルのアイコンサイズ設定には追従せず、options.json の固定値を
     * 使う（reference 実装と同じ単位系） */
    _toolIconSize() {
        return this._options.iconSize;
    }

    _buildToolButtons(state) {
        for (let b of this._toolButtons)
            b.destroy();
        this._toolButtons = [];

        if (!state.commands)
            return;

        let size = this._toolIconSize();
        for (let cmd of state.commands) {
            /* インライン表示は toolbar-show-*-button? が真の項目のみ
             * （GTK3 版 tool_button 生成ループと同じ規則） */
            if (!cmd.show_button)
                continue;

            let icon = null;
            if (cmd.icon_path) {
                icon = new St.Icon({
                    gicon: Gio.FileIcon.new(Gio.File.new_for_path(
                        cmd.icon_path)),
                    icon_type: St.IconType.FULLCOLOR,
                    icon_size: size,
                });
            } else {
                let symbolic = TOOL_SYMBOLIC_ICONS[cmd.command];
                if (symbolic) {
                    icon = new St.Icon({
                        icon_name: symbolic,
                        icon_type: St.IconType.SYMBOLIC,
                        icon_size: size,
                    });
                }
            }

            let button = new St.Button({
                reactive: true,
                button_mask: St.ButtonMask.ONE,
                track_hover: true,
                can_focus: true,
                style_class: 'uim-toolbar-button',
                style: this._buttonStyle(),
            });
            if (icon) {
                button.set_child(icon);
            } else {
                /* アイコンファイルもテーマアイコンも無い項目は
                 * テキスト代替（reference 実装と同様） */
                button.set_child(new St.Label({
                    text: cmd.label || cmd.desc,
                    style_class: 'uim-toolbar-button-label',
                }));
            }
            button.connect('clicked', () => {
                this._callSync('LaunchHelper',
                               new GLib.Variant('(s)', [cmd.command]));
            });
            /* Tooltips は actor destroy 時に自分も破棄される */
            new Tooltips.Tooltip(button, cmd.desc);

            this.actor.add(button);
            this._toolButtons.push(button);
        }
    }

    on_panel_icon_size_changed() {
        /* 基底側が _applet_icon にパネルサイズを適用した後で呼ばれる。
         * options.json の固定サイズへ戻す（reference 実装と同じ） */
        this._setIconSize();
    }

    /* ===== 左クリック: IM 選択メニュー ===== */

    on_applet_clicked(event) {
        /* 通常は _mainButton の 'clicked' が処理する。ボタン外の余白
         * クリックのフォールバックとして同じ開閉方針で扱う */
        this._ensureMainButton();
        if (!this.menu)
            return;
        if (this._dismissOpenMenus())
            return;
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
            /* リファレンスと同じく項目の先頭にアイコンを表示する
             * （span: 0 = 列を進めずラベルと同じ枠に収める） */
            if (leaf.icon_path) {
                let icon = new St.Icon({
                    gicon: Gio.FileIcon.new(Gio.File.new_for_path(
                        leaf.icon_path)),
                    icon_type: St.IconType.FULLCOLOR,
                    icon_size: this._options.iconSize,
                });
                item.addActor(icon, {span: 0});
            }
            item.setOrnament(PopupMenu.OrnamentType.DOT, leaf.selected);
            if (leaf.tooltip)
                new Tooltips.Tooltip(item.actor, leaf.tooltip);
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
        /* uiGroup 直置きのメニュー actor を放置しない */
        for (let m of this._branchMenus || [])
            m.destroy();
        this._branchMenus = [];
        if (this.menu)
            this.menu.destroy();
        if (this._proxy)
            this._proxy.run_dispose();
    }
}

function main(metadata, orientation, panel_height, instance_id) {
    return new UimToolbarApplet(orientation, panel_height, instance_id,
                                metadata);
}
