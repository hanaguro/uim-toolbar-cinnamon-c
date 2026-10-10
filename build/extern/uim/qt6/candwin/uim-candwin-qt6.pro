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
HEADERS += ./../../qt4/candwin/abstractcandidatewindow.h \
           ./../../qt4/candwin/candidatetablewindow.h \
           ./../../qt4/candwin/candidatewindow.h \
           ./../../qt4/candwin/subwindow.h \
           ./../../qt4/candwin/util.h \
           ./../../qt4/candwin/ximcandidatewindow.h
SOURCES += ./../../qt4/candwin/abstractcandidatewindow.cpp \
           ./../../qt4/candwin/candidatetablewindow.cpp \
           ./../../qt4/candwin/candidatewindow.cpp \
           ./../../qt4/candwin/qt4.cpp \
           ./../../qt4/candwin/subwindow.cpp \
           ./../../qt4/candwin/util.cpp \
           ./../../qt4/candwin/ximcandidatewindow.cpp

TARGET = uim-candwin-qt6

target.path += /usr/libexec
