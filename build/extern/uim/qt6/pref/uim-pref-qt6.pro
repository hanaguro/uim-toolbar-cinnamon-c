include(../../qt4/common.pro)

TEMPLATE = app
CONFIG += c++17

# to include qtgettext.h
INCLUDEPATH += ./../../qt4
LIBS += -luim-custom -luim-counted-init -luim 

# Input
HEADERS += ./../../qt4/pref/customwidgets.h \
           ./../../qt4/pref/qt4.h \
           ./../../qt4/pref/keyeditformbase.h \
           ./../../qt4/pref/olisteditformbase.h
SOURCES += ./../../qt4/pref/customwidgets.cpp \
           ./../../qt4/pref/qt4.cpp \
           ./../../qt4/pref/keyeditformbase.cpp \
           ./../../qt4/pref/olisteditformbase.cpp

TARGET = uim-pref-qt6

target.path += /usr/bin
