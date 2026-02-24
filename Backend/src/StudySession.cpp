#include "StudySession.h"
#include <algorithm>
#include <chrono>

StudySessionManager::StudySessionManager() {}

StudySession StudySessionManager::createSession(const std::string& subject) {
  StudySession session;
  session.id = "session_" + std::to_string(std::time(nullptr));
  session.subject = subject;
  session.startTime = std::time(nullptr);
  session.endTime = 0;
  session.durationMinutes = 0;
  session.notes = "";
  
  sessions.push_back(session);
  return session;
}

void StudySessionManager::endSession(const std::string& sessionId, const std::string& notes) {
  auto it = std::find_if(sessions.begin(), sessions.end(),
    [&sessionId](const StudySession& s) { return s.id == sessionId; });
  
  if (it != sessions.end()) {
    it->endTime = std::time(nullptr);
    it->durationMinutes = static_cast<int>((it->endTime - it->startTime) / 60);
    it->notes = notes;
  }
}

StudySession StudySessionManager::getSession(const std::string& id) const {
  auto it = std::find_if(sessions.begin(), sessions.end(),
    [&id](const StudySession& s) { return s.id == id; });
  
  if (it != sessions.end()) {
    return *it;
  }
  return StudySession();
}

std::vector<StudySession> StudySessionManager::getAllSessions() const {
  return sessions;
}

std::vector<StudySession> StudySessionManager::getSessionsBySubject(const std::string& subject) const {
  std::vector<StudySession> result;
  for (const auto& session : sessions) {
    if (session.subject == subject) {
      result.push_back(session);
    }
  }
  return result;
}
