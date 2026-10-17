#pragma once
#include <QByteArray>
namespace KWin {
class Window;
}
namespace Aevra {
QByteArray capture(KWin::Window *window);
}
