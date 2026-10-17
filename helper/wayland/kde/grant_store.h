// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QDir>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QSaveFile>
#include <QSet>
#include <sys/stat.h>
#include <unistd.h>
namespace Aevra {
// Consume a nonce before publishing authority, so crash/restart cannot replay
// it.
class GrantStore {
  QString path;

public:
  explicit GrantStore(QString path) : path(std::move(path)) {}
  bool accept(const QString &nonce) {
    QSet<QString> used;
    QFile input(path);
    if (QFileInfo::exists(path)) {
      struct stat st{};
      if (!input.open(QIODevice::ReadOnly) || fstat(input.handle(), &st) ||
          !S_ISREG(st.st_mode) || st.st_uid != getuid() ||
          (st.st_mode & 0077) || st.st_size > 1024 * 1024)
        return false;
      QJsonParseError error;
      auto doc = QJsonDocument::fromJson(input.readAll(), &error);
      if (error.error != QJsonParseError::NoError || !doc.isArray())
        return false;
      for (const auto &entry : doc.array()) {
        if (!entry.isString())
          return false;
        used.insert(entry.toString());
      }
    }
    if (nonce.isEmpty() || used.contains(nonce) || used.size() >= 4096)
      return false;
    used.insert(nonce);
    QJsonArray list;
    for (const auto &value : used)
      list.append(value);
    if (!QDir().mkpath(QFileInfo(path).absolutePath()))
      return false;
    QSaveFile output(path);
    if (!output.open(QIODevice::WriteOnly) ||
        !output.setPermissions(QFile::ReadOwner | QFile::WriteOwner))
      return false;
    auto bytes = QJsonDocument(list).toJson(QJsonDocument::Compact);
    return output.write(bytes) == bytes.size() && output.commit();
  }
};
} // namespace Aevra
