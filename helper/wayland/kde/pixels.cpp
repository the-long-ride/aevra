// SPDX-License-Identifier: GPL-2.0-or-later
// Offscreen window-item rendering follows KWin's screenshot implementation.
// SPDX-FileCopyrightText: 2010 Martin Graesslin <mgraesslin@kde.org>
// SPDX-FileCopyrightText: 2021 Vlad Zahorodnii <vlad.zahorodnii@kde.org>
#include "pixels.h"
#include <QBuffer>
#include <compositor.h>
#include <core/renderbackend.h>
#include <core/rendertarget.h>
#include <core/renderviewport.h>
#include <effect/effect.h>
#include <effect/effecthandler.h>
#include <opengl/eglcontext.h>
#include <opengl/glframebuffer.h>
#include <opengl/gltexture.h>
#include <scene/itemrenderer.h>
#include <scene/shadowitem.h>
#include <scene/windowitem.h>
#include <scene/workspacescene.h>
#include <window.h>
namespace Aevra {
QByteArray capture(KWin::Window *window) {
  using namespace KWin;
#ifdef AEVRA_NATIVE_FIXTURE
  qInfo() << "Aevra fixture capture backend"
          << Compositor::self()->backend()->compositingType() << "effects"
          << bool(effects);
#endif
  if (window->excludeFromCapture())
    throw QString("DESKTOP_CAPTURE_UNSUPPORTED");
  const auto geometry = window->frameGeometry();
  const auto scale = window->targetScale();
  const auto size = (geometry.size() * scale).toSize();
  if (size.width() <= 0 || size.height() <= 0 ||
      qint64(size.width()) * size.height() > 32 * 1024 * 1024)
    throw QString("DESKTOP_CAPTURE_UNSUPPORTED");
  QImage image(size, QImage::Format_RGBA8888);
  image.fill(Qt::transparent);
  auto renderer = Compositor::self()->scene()->renderer();
  auto render = [&](const RenderTarget &target) {
    RenderViewport viewport(geometry, scale, target, QPoint());
    renderer->beginFrame(target, viewport);
    renderer->renderItem(target, viewport, window->windowItem(),
                         Scene::PAINT_WINDOW_TRANSFORMED,
                         Region(Rect(QPoint(), size)), WindowPaintData{},
                         [w = window->windowItem()](Item *item) {
                           return item == w->shadowItem();
                         },
                         {});
    renderer->endFrame();
  };
  if (Compositor::self()->backend()->compositingType() == QPainterCompositing) {
    RenderTarget target(&image);
    render(target);
  } else {
    if (!effects || !effects->makeOpenGLContextCurrent())
      throw QString("DESKTOP_CAPTURE_UNSUPPORTED");
    auto context = EglContext::currentContext();
    if (!context)
      throw QString("DESKTOP_CAPTURE_UNSUPPORTED");
    auto texture = GLTexture::allocate(GL_RGBA8, size);
    if (!texture)
      throw QString("DESKTOP_CAPTURE_UNSUPPORTED");
    GLFramebuffer framebuffer(texture.get());
    if (!framebuffer.valid())
      throw QString("DESKTOP_CAPTURE_UNSUPPORTED");
    GLFramebuffer::pushFramebuffer(&framebuffer);
    glClearColor(0, 0, 0, 0);
    glClear(GL_COLOR_BUFFER_BIT);
    GLFramebuffer::popFramebuffer();
    RenderTarget target(&framebuffer);
    render(target);
    GLFramebuffer::pushFramebuffer(&framebuffer);
    context->glReadnPixels(0, 0, size.width(), size.height(), GL_RGBA,
                           GL_UNSIGNED_BYTE, image.sizeInBytes(), image.bits());
    GLFramebuffer::popFramebuffer();
    image = image.flipped(Qt::Vertical);
  }
  QByteArray bytes;
  QBuffer buffer(&bytes);
  buffer.open(QIODevice::WriteOnly);
  if (!image.save(&buffer, "PNG") || bytes.size() > 128 * 1024 * 1024)
    throw QString("DESKTOP_CAPTURE_UNSUPPORTED");
  return bytes;
}
} // namespace Aevra
