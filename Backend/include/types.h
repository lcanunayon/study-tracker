#ifndef TYPES_H
#define TYPES_H

#include <string>
#include <vector>
#include <set>
#include <map>
#include <ctime>
#include <uuid/uuid.h>

// Study Session structure
struct StudySession {
  std::string id;
  std::string subject;
  std::time_t startTime;
  std::time_t endTime;
  int durationMinutes;
  std::string notes;
  std::set<std::string> tags;
};

// Subject structure
struct Subject {
  std::string id;
  std::string name;
  std::string color;
  int totalStudyTimeMinutes;
  int goalHoursPerWeek;
};

// Statistics structure
struct Statistics {
  std::map<std::string, int> weeklyBreakdown;
  std::map<std::string, int> subjectDistribution;
  int currentStreak;
  int longestStreak;
  std::time_t lastSessionDate;
};

#endif // TYPES_H
