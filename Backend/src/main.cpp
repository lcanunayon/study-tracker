#include <iostream>
#include "StudySession.h"
#include "StorageManager.h"

int main() {
  std::cout << "Study Tracker Backend v0.1.0" << std::endl;
  std::cout << "Backend initialized successfully" << std::endl;
  
  // Initialize managers
  StudySessionManager sessionManager;
  StorageManager storageManager("./data");
  
  std::cout << "Ready to receive IPC messages from Electron frontend" << std::endl;
  
  return 0;
}
