cmake_minimum_required(VERSION 3.17)
project(uim-toolbar-cinnamon LANGUAGES C CXX)

set(CMAKE_SKIP_INSTALL_ALL_DEPENDENCY ON)

# ==========================
#  uim autogen + configure 実行
# ==========================
set(UIM_SRC_DIR    ${CMAKE_SOURCE_DIR}/extern/uim)
set(UIM_BUILD_DIR  ${CMAKE_BINARY_DIR}/extern/uim)
set(UIM_COPY_STAMP ${UIM_BUILD_DIR}/.sources-copied)
set(UIM_CONFIGURE_SCRIPT ${UIM_BUILD_DIR}/configure)
set(UIM_CONFIG_STATUS ${UIM_BUILD_DIR}/config.status)
set(UIM_CONFIG_HEADER ${UIM_BUILD_DIR}/config.h)

add_custom_command(
    OUTPUT ${UIM_COPY_STAMP}
    COMMAND ${CMAKE_COMMAND} -E rm -rf ${UIM_BUILD_DIR}
    COMMAND ${CMAKE_COMMAND} -E copy_directory ${UIM_SRC_DIR} ${UIM_BUILD_DIR}
    COMMAND ${CMAKE_COMMAND} -E touch ${UIM_COPY_STAMP}
    DEPENDS ${UIM_SRC_DIR}/autogen.sh
    COMMENT "Copying uim sources into build tree"
    VERBATIM
)

add_custom_command(
    OUTPUT ${UIM_CONFIGURE_SCRIPT}
    COMMAND ${CMAKE_COMMAND} -E env NOCONFIGURE=1 ./autogen.sh
    WORKING_DIRECTORY ${UIM_BUILD_DIR}
    DEPENDS ${UIM_COPY_STAMP}
    COMMENT "Running uim autogen.sh"
    VERBATIM
)

add_custom_target(uim_autogen DEPENDS ${UIM_CONFIGURE_SCRIPT})

add_custom_command(
    OUTPUT ${UIM_CONFIG_STATUS} ${UIM_CONFIG_HEADER}
    COMMAND ${CMAKE_COMMAND} -E make_directory ${UIM_BUILD_DIR}
    COMMAND ${CMAKE_COMMAND} -E env
            CC=${CMAKE_C_COMPILER}
            CXX=${CMAKE_CXX_COMPILER}
            ./configure
                --prefix=/usr
		--libdir=/usr/lib
		--sysconfdir=/etc
		--localstatedir=/var
		--mandir=/usr/share/man
		--disable-static
		--enable-shared
		--without-qt4
		--without-qt5
		--without-qt6
		--without-qt4-immodule
		--without-qt5-immodule
		--without-qt6-immodule
		--without-gtk2
		--without-gtk3
		--without-gtk4
    WORKING_DIRECTORY ${UIM_BUILD_DIR}
    DEPENDS ${UIM_CONFIGURE_SCRIPT}
    BYPRODUCTS ${UIM_BUILD_DIR}/Makefile
    COMMENT "Configuring uim (extern/uim)"
    VERBATIM
)

add_custom_target(uim_config ALL DEPENDS ${UIM_CONFIG_STATUS})
add_dependencies(uim_config uim_autogen)

# ==========================
#  ビルド設定
# ==========================
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ==========================
#  Debugマクロ設定
# ==========================
if(CMAKE_BUILD_TYPE STREQUAL "Debug")
    add_compile_definitions(DEBUG_BUILD)
    message(STATUS "Debug build: DEBUG_BUILD macro defined")
else()
    message(STATUS "Release build: Debug logs disabled")
endif()

# ==========================
#  依存関係
#  (Cinnamon版: Qt/LXQt ではなく GLib を使う)
# ==========================
find_package(PkgConfig REQUIRED)
pkg_check_modules(GLIB REQUIRED glib-2.0 gio-2.0)
pkg_check_modules(JSONGLIB REQUIRED json-glib-1.0)
pkg_check_modules(UIM REQUIRED uim)

# ==========================
#  ソース
#  (uim ツールバー共通ロジックは GTK3 ツールバーの C 実装を参考にした
#   common-cinnamon.c。Qt 版 common-quimhelpertoolbar.cpp /
#   common-uimstateindicator.cpp 相当)
# ==========================
add_executable(uim-toolbar-cinnamon
    src/main.cpp
    src/uimtoolbarcinnamon.cpp
    src/common-cinnamon.c
)

# ==========================
#  インクルードパス
# ==========================
target_include_directories(uim-toolbar-cinnamon PRIVATE
    ${UIM_BUILD_DIR}
    ${UIM_BUILD_DIR}/replace
    ${UIM_BUILD_DIR}/uim
    ${UIM_BUILD_DIR}/uim/uim
    ${CMAKE_CURRENT_BINARY_DIR}
    ${CMAKE_CURRENT_SOURCE_DIR}/src
    ${GLIB_INCLUDE_DIRS}
    ${JSONGLIB_INCLUDE_DIRS}
    ${UIM_INCLUDE_DIRS}
)

# ==========================
#  リンク
# ==========================
target_link_libraries(uim-toolbar-cinnamon
    ${GLIB_LIBRARIES}
    ${JSONGLIB_LIBRARIES}
    ${UIM_LIBRARIES}
)

# main.cpp が <config.h>（extern/uim の configure 生成）経由で使う
# GETTEXT_PACKAGE / LOCALEDIR を定義する（GTK3 ツールバーと同じ値）
target_compile_definitions(uim-toolbar-cinnamon PRIVATE
    GETTEXT_PACKAGE="uim"
    LOCALEDIR="/usr/share/locale"
)

add_dependencies(uim-toolbar-cinnamon uim_config)

# ==========================
#  インストール
#  (Cinnamon版: パネルプラグイン .so ではなく、
#   アプレット(uim-toolbar@cinnamon.org)が起動する常駐バイナリと
#   アプレット本体をインストールする)
# ==========================
set(CINNAMON_APPLET_DIR "/usr/share/cinnamon/applets/uim-toolbar@cinnamon.org")

install(TARGETS uim-toolbar-cinnamon
    RUNTIME DESTINATION /usr/bin
)

install(FILES
    applet/metadata.json
    applet/applet.js
    DESTINATION ${CINNAMON_APPLET_DIR}
)

# ==========================
#  make uninstall ターゲット
# ==========================
if(NOT TARGET uninstall)
    configure_file(
        "${CMAKE_CURRENT_SOURCE_DIR}/cmake_uninstall.cmake.in"
        "${CMAKE_CURRENT_BINARY_DIR}/cmake_uninstall.cmake"
        IMMEDIATE @ONLY
    )

    add_custom_target(uninstall
        COMMAND ${CMAKE_COMMAND} -P ${CMAKE_CURRENT_BINARY_DIR}/cmake_uninstall.cmake
        COMMENT "Uninstalling files installed by 'make install'"
    )
endif()
