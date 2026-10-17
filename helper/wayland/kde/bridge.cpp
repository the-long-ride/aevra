// SPDX-License-Identifier: GPL-2.0-or-later
#include "bridge.h"
#include "pixels.h"
#include <QDBusConnectionInterface>
#include <QDBusReply>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QStandardPaths>
#include <effect/effecthandler.h>
#include <input.h>
#include <sys/stat.h>
#include <unistd.h>
#include <wayland/clientconnection.h>
#include <wayland/surface.h>
#include <wayland_server.h>
#include <window.h>
#include <workspace.h>
using namespace KWin;
namespace Aevra {
Bridge::Bridge()
    : grants(QStandardPaths::writableLocation(QStandardPaths::StateLocation) +
             "/aevra/wayland-grants.json") {
  watcher.setConnection(QDBusConnection::sessionBus());
  watcher.setWatchMode(QDBusServiceWatcher::WatchForUnregistration);
  connect(&watcher, &QDBusServiceWatcher::serviceUnregistered, this,
          &Bridge::close);
  connect(waylandServer(), &WaylandServer::lockStateChanged, this, [this] {
    if (waylandServer()->isScreenLocked())
      revoke();
  });
  timer.setInterval(200);
  connect(&timer, &QTimer::timeout, this, [this] { syncGrant(); });
  timer.start();
  QDBusConnection::sessionBus().registerObject("/org/aevra/Desktop", this,
                                               QDBusConnection::ExportAllSlots);
}
Bridge::~Bridge() {
  revoke();
  QDBusConnection::sessionBus().unregisterObject("/org/aevra/Desktop");
}
void Bridge::close(const QString &owner) {
  peers.remove(owner);
  policy.close(owner);
  watcher.removeWatchedService(owner);
}
void Bridge::revoke() {
  policy.revoke();
  for (const auto &owner : peers.keys())
    close(owner);
}
void Bridge::syncGrant() {
#ifdef AEVRA_NATIVE_FIXTURE
  if (fixtureEnabled)
    policy.grant(QString::number(fixtureGrant));
  else
    revoke();
  return;
#endif
  QFile file(QStandardPaths::writableLocation(QStandardPaths::ConfigLocation) +
             "/aevra-wayland.json");
  struct stat st{};
  if (!file.open(QIODevice::ReadOnly) || fstat(file.handle(), &st) ||
      !S_ISREG(st.st_mode) || st.st_uid != getuid() || (st.st_mode & 0077) ||
      st.st_size > 4096) {
    revoke();
    return;
  }
  auto doc = QJsonDocument::fromJson(file.readAll()).object();
  auto nonce = doc.value("grant").toString();
  auto path = doc.value("helperPath").toString();
  if (doc.value("enabled") != true || nonce.size() < 16 || nonce.size() > 128 ||
      !QFileInfo(path).isAbsolute()) {
    revoke();
    return;
  }
  if (grantPath != path || grantNonce != nonce) {
    if (grantPath != path && grantNonce == nonce) {
      revoke();
      return;
    }
    for (const auto &owner : peers.keys())
      close(owner);
    if (!grants.accept(nonce)) {
      revoke();
      return;
    }
    grantPath = path;
    grantNonce = nonce;
  }
  if (waylandServer()->isScreenLocked()) {
    revoke();
    return;
  }
  policy.grant(nonce);
}
bool Bridge::eligible(const QString &owner) {
#ifdef AEVRA_NATIVE_FIXTURE
  return fixtureEnabled;
#endif
  auto bus = QDBusConnection::sessionBus().interface();
  auto uid = bus->serviceUid(owner);
  auto pid = bus->servicePid(owner);
  if (!uid.isValid() || !pid.isValid() || uid.value() != getuid())
    return false;
  auto path =
      QFileInfo(QString("/proc/%1/exe").arg(pid.value())).symLinkTarget();
  auto name = QFileInfo(path).fileName();
  return !path.isEmpty() && path == grantPath &&
         (name == "aevra-desktop-helper" || name == "aevra-desktop");
}
void Bridge::require(const QString &owner) {
  syncGrant();
  if (waylandServer()->isScreenLocked() || !policy.authorized(owner))
    throw QString("DESKTOP_PERMISSION_REQUIRED");
}
QList<Window *> Bridge::windows() {
  QList<Window *> result;
  for (auto w : workspace()->windows())
    if (w->inherits("KWin::WaylandWindow") && w->surface() &&
        w->surface()->client()->processId() == w->pid() && !w->isDeleted() &&
        !w->isMinimized() && w->isShown() && w->pid() > 0 &&
        w->frameGeometry().width() > 0 && w->frameGeometry().height() > 0)
      result.append(w);
  return result;
}
quint32 Bridge::id(Window *w) {
  auto uuid = w->internalId();
  if (!ids.contains(uuid)) {
    if (next == 0)
      throw QString("DESKTOP_PROVIDER_UNAVAILABLE");
    ids.insert(uuid, next++);
  }
  return ids.value(uuid);
}
QJsonObject Bridge::info(Window *w) {
  const auto r = w->frameGeometry();
  return {{"id", int(id(w))},
          {"pid", int(w->pid())},
          {"focused", workspace()->activeWindow() == w},
          {"rect", QJsonObject{{"x", int(r.x())},
                               {"y", int(r.y())},
                               {"width", int(r.width())},
                               {"height", int(r.height())}}}};
}
Window *Bridge::target(quint32 requested) {
  for (auto w : windows())
    if (id(w) == requested)
      return w;
  throw QString("DESKTOP_TARGET_CHANGED");
}
QJsonValue Bridge::dispatch(const QString &owner, const QString &method,
                            const QJsonObject &args) {
#ifdef AEVRA_NATIVE_FIXTURE
  if (method == "Fixture")
    return fixture(args);
#endif
  if (method == "Open") {
    syncGrant();
    if (args.value("version") != 1 || waylandServer()->isScreenLocked() ||
        !eligible(owner) || !policy.open(owner))
      throw QString("DESKTOP_PERMISSION_REQUIRED");
    if (!peers.contains(owner)) {
      if (peers.size() >= 32) {
        policy.close(owner);
        throw QString("DESKTOP_INPUT_REFUSED");
      }
      peers.insert(owner, std::make_shared<Device>());
      watcher.addWatchedService(owner);
    }
    return QJsonObject{{"version", 1}};
  }
  if (method == "Input" && peers.contains(owner) &&
      peers.value(owner)->cleanup(args))
    return true;
  require(owner);
  if (method == "Probe")
    return QJsonObject{{"version", 1}};
  if (method == "Windows") {
    QJsonArray list;
    for (auto w : windows())
      list.append(info(w));
    return list;
  }
  if (method == "Pointer") {
    auto p = input()->globalPointer();
    return QJsonArray{int(p.x()), int(p.y())};
  }
  if (method == "Hit") {
    auto w = input()->findToplevel(
        QPointF(args.value("x").toDouble(), args.value("y").toDouble()));
    return w && windows().contains(w) ? int(id(w)) : 0;
  }
  if (method == "Input") {
    auto w = target(args.value("id").toInt());
    if (!validTarget(id(w), w->pid(), workspace()->activeWindow() == w,
                     args.value("id").toInt(), args.value("pid").toInt()) ||
        (effects &&
         (effects->activeFullScreenEffect() || effects->hasKeyboardGrab() ||
          effects->isMouseInterception())))
      throw QString("DESKTOP_INPUT_REFUSED");
    peers.value(owner)->perform(args, w);
    return true;
  }
  throw QString("DESKTOP_INPUT_REFUSED");
}
QString Bridge::Call(const QString &method, const QString &json) {
  try {
    if (json.size() > 65536)
      throw QString("DESKTOP_INPUT_REFUSED");
    QJsonParseError error;
    auto doc = QJsonDocument::fromJson(json.toUtf8(), &error);
    if (error.error != QJsonParseError::NoError || !doc.isObject())
      throw QString("DESKTOP_INPUT_REFUSED");
    auto value = dispatch(message().service(), method, doc.object());
    // Qt serializes scalars only inside a container; strip its outer array.
    auto bytes =
        QJsonDocument(QJsonArray{value}).toJson(QJsonDocument::Compact);
    return QString::fromUtf8(bytes.mid(1, bytes.size() - 2));
  } catch (const QString &code) {
    return QString::fromUtf8(QJsonDocument(QJsonObject{{"error", code}})
                                 .toJson(QJsonDocument::Compact));
  }
}
QByteArray Bridge::Capture(quint32 requested) {
  try {
    require(message().service());
    auto w = target(requested);
    auto bytes = capture(w);
    require(message().service());
    if (target(requested) != w)
      throw QString("DESKTOP_TARGET_CHANGED");
    return bytes;
  } catch (const QString &code) {
#ifdef AEVRA_NATIVE_FIXTURE
    qWarning() << "Aevra fixture capture refused" << code;
#endif
    sendErrorReply("org.aevra.Desktop.Refused",
                   "Capture unavailable; check permission and target");
    return {};
  }
}
#ifdef AEVRA_NATIVE_FIXTURE
QJsonValue Bridge::fixture(const QJsonObject &args) {
  const auto op = args.value("op").toString();
  if (op == "fractional") {
    auto point = input()->globalPointer();
    for (const auto &peer : peers) {
      Q_EMIT peer->pointerMotionAbsolute(
          point + QPointF(0.5, 0.5),
          std::chrono::duration_cast<std::chrono::microseconds>(
              std::chrono::steady_clock::now().time_since_epoch()),
          peer.get());
      Q_EMIT peer->pointerFrame(peer.get());
      break;
    }
  }
  if (op == "allow") {
    fixtureEnabled = true;
    ++fixtureGrant;
    syncGrant();
  }
  if (op == "pause") {
    fixtureEnabled = false;
    revoke();
  }
  for (auto w : windows())
    if (w->pid() == args.value("pid").toInt()) {
      if (op == "focus")
        workspace()->activateWindow(w, true);
      if (op == "above")
        w->setKeepAbove(true);
      if (op == "move")
        w->moveResize(QRectF(args.value("x").toInt(), args.value("y").toInt(),
                             args.value("width").toInt(),
                             args.value("height").toInt()));
    }
  return QJsonObject{{"ok", true}};
}
#endif
} // namespace Aevra
class Factory : public PluginFactory {
  Q_OBJECT
  Q_PLUGIN_METADATA(IID PluginFactory_iid FILE "metadata.json")
  Q_INTERFACES(KWin::PluginFactory)
public:
  std::unique_ptr<Plugin> create() const override {
    return std::make_unique<Aevra::Bridge>();
  }
};
#include "bridge.moc"
