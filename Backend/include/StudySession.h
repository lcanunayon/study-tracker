#ifndef STUDY_SESSION_H
#define STUDY_SESSION_H

#include "types.h"

class StudySessionManager {
public:
  StudySessionManager();
  
  StudySession createSession(const std::string& subject);
  void endSession(const std::string& sessionId, const std::string& notes = "");
  StudySession getSession(const std::string& id) const;
  std::vector<StudySession> getAllSessions() const;
  std::vector<StudySession> getSessionsBySubject(const std::string& subject) const;
  
private:
  std::vector<StudySession> sessions;
};

#endif // STUDY_SESSION_H
