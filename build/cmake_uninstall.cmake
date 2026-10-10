# cmake_uninstall.cmake.in

if(NOT DEFINED CMAKE_INSTALL_PREFIX)
    set(CMAKE_INSTALL_PREFIX "/usr/local")
endif()

message(STATUS "Uninstalling files from ${CMAKE_INSTALL_PREFIX}")

if(NOT EXISTS "/home/takahiro/work/uim-toolbar-cinnamon/build/install_manifest.txt")
    message(FATAL_ERROR "Cannot find install manifest: /home/takahiro/work/uim-toolbar-cinnamon/build/install_manifest.txt")
endif()

file(READ "/home/takahiro/work/uim-toolbar-cinnamon/build/install_manifest.txt" files)
string(REPLACE "\n" ";" files "${files}")

foreach(file ${files})
    if(EXISTS "${file}")
        message(STATUS "Removing ${file}")
        execute_process(COMMAND "${CMAKE_COMMAND}" -E remove "${file}")
    else()
        message(STATUS "File not found: ${file}")
    endif()
endforeach()
