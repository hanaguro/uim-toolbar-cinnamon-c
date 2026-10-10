# README.md

uim-toolbar-cinnamon
====================

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
make install で /usr/bin/uim-toolbar-cinnamon（常駐プロセス）と
/usr/share/cinnamon/applets/uim-toolbar@cinnamon.org（アプレット）が
インストールされる。
パネル右クリック → 「アプレットの追加」 → "UIM Toolbar" を追加する。
常駐プロセスが落ちていた場合はアプレットが自動で起動を試みる。
