include(../../qt4/common.pro)

CONFIG += c++17

# to include qtgettext.h
INCLUDEPATH += ./../../qt4
LIBS +=  -lX11

!versionAtLeast(QT_VERSION, 6.4.0) {
    QT += core5compat
}

# Input
HEADERS += ./../../qt4/chardict/bushuviewwidget.h \
           ./../../qt4/chardict/chargridview.h \
           ./../../qt4/chardict/qt4.h \
           ./../../qt4/chardict/unicodeviewwidget.h
SOURCES += ./../../qt4/chardict/bushuviewwidget.cpp \
           ./../../qt4/chardict/chargridview.cpp \
           ./../../qt4/chardict/qt4.cpp \
           ./../../qt4/chardict/unicodeviewwidget.cpp

TARGET = uim-chardict-qt6

target.path += /usr/bin
