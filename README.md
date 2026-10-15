# README.md

uim-toolbar-cinnamon
====================

uim-toolbar-qt6-lxqtwidget（LXQt 版）と同じ仕様の Cinnamon 用 uim ツールバー。
LXQt ではパネルウィジェット（Qt6 プラグイン）だった部分を、Cinnamon では
アプレット（uim-toolbar@cinnamon.org）+ D-Bus 常駐プロセスに置き換えた。

Download
-----
git clone https://github.com/hanaguro/uim-toolbar-cinnamon-c.git  
cd uim-toolbar-cinnamon  
git submodule init  
git submodule update  

Build
-----
mkdir build && cd build  
cmake -DCMAKE_BUILD_TYPE=Release ..  
make -j$(nproc)  

Install
-----
sudo make install  

Use
-----
make install で以下がインストールされる。

- /usr/share/cinnamon/applets/uim-toolbar@cinnamon.org/
  - applet.js ・ metadata.json ・ stylesheet.css ・ options.json （アプレット）
  - uim-toolbar-cinnamon （D-Bus 常駐プロセス）

常駐プロセスは /usr/bin 等には置かず、アプレットと同じディレクトリに
同梱される。アプレットは自身のインストール先（metadata.path）から
フルパスで起動するため、~/.cinnamon/extensions 配下にコピーして
使う場合もそのまま動く。

インストール後、Cinnamon を再起動するか「Cinnamon の再起動」を行う。

### 1. アプレットの追加
パネル右クリック → 「アプレットの追加」 → "UIM Toolbar" を追加する。

### 2. 常駐プロセス
アプレットを追加すると、D-Bus サービス org.uim.toolbar を検知し、
常駐プロセスが起動していなければアプレットと同じディレクトリの
uim-toolbar-cinnamon を自動的に起動する。
常駐プロセスが異常終了した場合も、アプレットが検知して再起動する。
常駐プロセス単体での autostart は不要（アプレット側で面倒を見るため）。

### 3. 表示
uim-helper サーバーに接続できると、uim の状態変化にあわせて自動更新される。
GTK3 版と同じく、uim-helper が送る branch グループ 1 つにつきボタン 1 個を
並べる（1 表示ボタン = 1 branch）。例えば SKK 使用时は
「入力メソッド切替 (Sk)」「入力モード (あ / Ｒ など現在モード)」の
branch が届くため、それぞれ個別のボタンとして表示され、
各ボタンは自身の branch の leaf 一覧メニューを持つ。
uim-helper 未接続のときは左クリックメニューに「uim-helper 未接続」と表示される。

アイコンは toolbar-icon-for-dark-background? が真の場合、
/usr/share/uim/pixmaps の *_dark_background.png を優先して使う（GTK3/LXQt 版と同じ）。
toolbar-display-time の設定に従って表示/非表示が決まる（"mode" の場合、
direct モード時は非表示になる）。
なお branch ボタンは toolbar-show-switcher-button? の設定に関係なく表示される
（GTK3 版の prop_button と同じ扱い）。

複数のメニューを同時に開かないこと。Cinnamon の PopupMenuManager は
オーナーにつき 1 メニュー = 1 grab 前提のため、いずれかが開いている間の
クリックは「開いているメニューを閉じるだけ」となり、GTK3 ツールバーと
同じ操作感になる。

### 4. 左クリック: 入力メソッドの切り替え
ボタンをクリックするとその branch の leaf 選択メニューが開く。
現在の選択項目にはドット印が付く。
項目を選ぶと uim-helper へ prop_activate が送信され、入力メソッドや
入力モードが切り替わる。
uim-toolbar-save-default-im? が真の場合、切り替え結果が
custom-preserved-default-im-name に保存される（LXQt 版と同じ動作）。

### 5. ツールボタン（インライン表示）
GTK3 版と同じく toolbar-show-*-button? が真の項目は、IM 表示の隣に
ツールボタンとして並ぶ（既定では Preference のみ）。
uim のアイコンファイル (/usr/share/uim/pixmaps) が無い項目は
テーマのシンボリックアイコンで代替表示する。
custom_reload_notify を受けると設定変更を反映して再構成する。

### 6. 右クリック: ヘルパーアプリの起動
右クリックで以下のメニューが開く（LXQt 版のアプレットモードと同様、
全項目常に表示される。GTK3 版の右クリックメニューと同様で、
ツールボタンの表示切替 toolbar-show-*-button? は影響しない）。

- Switch input method → uim-im-switcher-gtk3
- Preference → uim-pref-gtk3
- Japanese dictionary editor → uim-dict-gtk3
- Input pad → uim-input-pad-ja-gtk3
- Handwriting input pad → uim-tomoe-gtk
- Help → uim-help
- （区切り線）
- ツールバーを終了 → 常駐プロセスを終了する（常駐終了後はアプレットが
  次回必要時に再起動するため、パネル表示は残る）

Uninstall
-----
cd build && sudo make uninstall
