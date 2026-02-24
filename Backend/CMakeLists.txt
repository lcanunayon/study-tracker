cmake_minimum_required(VERSION 3.16)
project(StudyTrackerBackend)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Source files
set(SOURCES
  src/main.cpp
  src/StudySession.cpp
  src/StorageManager.cpp
)

set(HEADERS
  include/StudySession.h
  include/StorageManager.h
  include/types.h
)

# Create executable
add_executable(study-tracker-backend ${SOURCES} ${HEADERS})

# Include directories
target_include_directories(study-tracker-backend PRIVATE include)

# Platform-specific settings
if(WIN32)
  target_compile_options(study-tracker-backend PRIVATE /W4)
else()
  target_compile_options(study-tracker-backend PRIVATE -Wall -Wextra -Wpedantic)
endif()
