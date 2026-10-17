#pragma once
#include <QSet>
#include <QString>
#include <cmath>
namespace Aevra {
class Policy {
  QString current, consumed;
  QSet<QString> owners;

public:
  void grant(const QString &nonce) {
    if (nonce.isEmpty()) {
      revoke();
      return;
    }
    if (nonce == consumed)
      return;
    if (nonce != current) {
      owners.clear();
      current = nonce;
    }
  }
  void revoke() {
    if (!current.isEmpty())
      consumed = current;
    current.clear();
    owners.clear();
  }
  bool open(const QString &owner) {
    if (current.isEmpty())
      return false;
    owners.insert(owner);
    return true;
  }
  bool authorized(const QString &owner) const {
    return !current.isEmpty() && owners.contains(owner);
  }
  void close(const QString &owner) { owners.remove(owner); }
};
inline bool validTarget(quint32 id, quint32 pid, bool focused,
                        quint32 requestedId, quint32 requestedPid) {
  return id && pid && focused && id == requestedId && pid == requestedPid;
}
inline bool validPoint(double x, double y, double width, double height,
                       double px, double py) {
  return std::isfinite(px) && std::isfinite(py) && width > 0 && height > 0 &&
         px >= x && py >= y && px < x + width && py < y + height;
}
inline bool validMovePoint(double x, double y, double width, double height,
                           double px, double py) {
  return validPoint(x, y, width, height, px, py) && std::floor(px) == px &&
         std::floor(py) == py;
}
} // namespace Aevra
