include(../../qt4/common.pro)

TEMPLATE = app
CONFIG += c++17

# to include qtgettext.h
INCLUDEPATH += ./../../qt4
LIBS += 

!versionAtLeast(QT_VERSION, 6.4.0) {
    QT += core5compat
}

# Input
HEADERS += ./../../qt4/toolbar/common-quimhelpertoolbar.h \
           ./../../qt4/toolbar/common-uimstateindicator.h \
           ./../../qt4/toolbar/standalone-qt4.h
SOURCES += ./../../qt4/toolbar/common-quimhelpertoolbar.cpp \
           ./../../qt4/toolbar/common-uimstateindicator.cpp \
           ./../../qt4/toolbar/standalone-qt4.cpp

TARGET = uim-toolbar-qt6

target.path += /usr/bin
