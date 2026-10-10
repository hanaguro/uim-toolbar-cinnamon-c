include(../../qt4/common.pro)

TEMPLATE = lib
CONFIG += plugin
CONFIG += c++17

# to include util.h and for quimplatforminputcontext.cpp
INCLUDEPATH += ./../../qt4/candwin \
               ./../../qt4/immodule \
               ./../../qt5/immodule \
               .

LIBS += -lX11 -luim-counted-init

QT += gui-private
!versionAtLeast(QT_VERSION, 6.4.0) {
    QT += core5compat
}

# Input
HEADERS += ./../../qt4/immodule/candidatewindowproxy.h \
           ./../../qt4/immodule/caretstateindicator.h \
           ./../../qt4/immodule/plugin.h \
           ./../../qt4/immodule/qhelpermanager.h \
           ./../../qt4/immodule/qtextutil.h \
           ./../../qt4/immodule/quiminfomanager.h \
           ./../../qt4/candwin/util.h \
           ./../../qt5/immodule/quimplatforminputcontext.h

SOURCES += ./../../qt4/immodule/candidatewindowproxy.cpp \
           ./../../qt4/immodule/caretstateindicator.cpp \
           ./../../qt4/immodule/plugin.cpp \
           ./../../qt4/immodule/qhelpermanager.cpp \
           ./../../qt4/immodule/qtextutil.cpp \
           ./../../qt4/immodule/quiminfomanager.cpp \
           ./../../qt4/candwin/util.cpp \
           ./../../qt5/immodule/quimplatforminputcontext.cpp

!win32:!embedded:!mac {
    HEADERS += ./../../qt4/immodule/quiminputcontext_compose.h
    SOURCES += ./../../qt4/immodule/quiminputcontext_compose.cpp
}

OTHER_FILES += ./../../qt5/immodule/uim.json

TARGET = uimplatforminputcontextplugin
DESTDIR = 
target.path += $$[QT_INSTALL_PLUGINS]/platforminputcontexts
