#ifndef STORAGE_MANAGER_H
#define STORAGE_MANAGER_H

#include "types.h"
#include <string>

class StorageManager {
public:
  StorageManager(const std::string& dataPath);
  
  bool saveSession(const StudySession& session);
  bool loadSessions(std::vector<StudySession>& sessions);
  bool saveSubject(const Subject& subject);
  bool loadSubjects(std::vector<Subject>& subjects);
  bool createBackup(const std::string& backupPath);
  bool exportToJSON(const std::string& outputPath);
  
private:
  std::string dataDirectory;
  std::string dbPath;
  
  bool ensureDirectoryExists(const std::string& path);
};

#endif // STORAGE_MANAGER_H
