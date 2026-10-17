// SPDX-License-Identifier: GPL-2.0-or-later
#pragma once
#include <QJsonObject>
#include <QMap>
#include <core/inputdevice.h>
namespace KWin {
class Window;
}
namespace Aevra {
class Device : public KWin::InputDevice {
  bool enabled = true;
  struct Held {
    quint32 code;
    bool shift;
  };
  QMap<quint32, Held> keys;
  bool button = false;
  void sendKey(quint32 code, bool down);

public:
  Device();
  ~Device() override;
  QString name() const override { return "Aevra explicitly granted input"; }
  bool isEnabled() const override { return enabled; }
  void setEnabled(bool v) override { enabled = v; }
  bool isKeyboard() const override { return true; }
  bool isPointer() const override { return true; }
  bool isTouchpad() const override { return false; }
  bool isTouch() const override { return false; }
  bool isTabletTool() const override { return false; }
  bool isTabletPad() const override { return false; }
  bool isTabletModeSwitch() const override { return false; }
  bool isLidSwitch() const override { return false; }
  void release();
  bool cleanup(const QJsonObject &args);
  void perform(const QJsonObject &args, KWin::Window *window);
};
} // namespace Aevra
