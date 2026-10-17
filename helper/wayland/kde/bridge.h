// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include "device.h"
#include "grant_store.h"
#include "policy.h"
#include <QDBusContext>
#include <QDBusServiceWatcher>
#include <QJsonObject>
#include <QMap>
#include <QTimer>
#include <QUuid>
#include <plugin.h>
namespace KWin {
class Window;
}
namespace Aevra {
class Bridge : public KWin::Plugin, protected QDBusContext {
  Q_OBJECT
  Q_CLASSINFO("D-Bus Interface", "org.aevra.Desktop1")
  Policy policy;
  GrantStore grants;
  QMap<QString, std::shared_ptr<Device>> peers;
  QMap<QUuid, quint32> ids;
  quint32 next = 1;
  QString grantNonce, grantPath;
  QDBusServiceWatcher watcher;
  QTimer timer;
#ifdef AEVRA_NATIVE_FIXTURE
  bool fixtureEnabled = false;
  quint32 fixtureGrant = 0;
  QJsonValue fixture(const QJsonObject &args);
#endif
  void close(const QString &owner);
  void revoke();
  void syncGrant();
  bool eligible(const QString &owner);
  void require(const QString &owner);
  QList<KWin::Window *> windows();
  quint32 id(KWin::Window *window);
  QJsonObject info(KWin::Window *window);
  KWin::Window *target(quint32 id);
  QJsonValue dispatch(const QString &owner, const QString &method,
                      const QJsonObject &args);

public:
  Bridge();
  ~Bridge() override;
public Q_SLOTS:
  QString Call(const QString &method, const QString &json);
  QByteArray Capture(quint32 id);
};
} // namespace Aevra
