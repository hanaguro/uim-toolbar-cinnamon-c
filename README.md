# README.md

uim-toolbar-cinnamon
====================

uim-toolbar-qt6-lxqtwidget（LXQt 版）と同じ仕様の Cinnamon 用 uim ツールバー。
LXQt ではパネルウィジェット（Qt6 プラグイン）だった部分を、Cinnamon では
アプレット（uim-toolbar@cinnamon.org）+ D-Bus 常駐プロセスに置き換えた。

Download
-----
git clone https://github.com/hanaguro/uim-toolbar-cinnamon.git  
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

- /usr/share/cinnamon/applets/uim-toolbar@cinnamon.org （アプレット）
- /usr/bin/uim-toolbar-cinnamon （D-Bus 常駐プロセス）

1. パネル右クリック → 「アプレットの追加」 → "UIM Toolbar" を追加する。
2. 常駐プロセス（org.uim.toolbar）を起動する。アプレットが検知して
   自動起動も試みるが、ログイン時に自動起動させる場合は
   ~/.config/autostart/uim-toolbar-cinnamon.desktop に例えば以下を置く。

   [Desktop Entry]
   Type=Application
   Name=uim-toolbar-cinnamon
   Exec=/usr/bin/uim-toolbar-cinnamon

3. ツールバーの IM 一覧から入力メソッドを切り替えられる。
   uim-toolbar-save-default-im? が真の場合は切り替え結果が
   custom-preserved-default-im-name に保存される（LXQt 版と同じ動作）。

Uninstall
-----
cd build && sudo make uninstall
