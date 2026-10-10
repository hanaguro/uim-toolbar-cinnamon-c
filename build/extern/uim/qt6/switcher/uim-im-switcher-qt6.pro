include(../../qt4/common.pro)

TEMPLATE = app
CONFIG += c++17

# to include qtgettext.h
INCLUDEPATH += ./../../qt4
LIBS += -lreplace -luim -luim-scm -luim-custom 

!versionAtLeast(QT_VERSION, 6.4.0) {
    QT += core5compat
}

# Input
HEADERS += ./../../qt4/switcher/qt4.h
SOURCES += ./../../qt4/switcher/qt4.cpp

TARGET = uim-im-switcher-qt6

target.path += /usr/bin
