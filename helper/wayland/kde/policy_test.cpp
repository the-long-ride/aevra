#include "grant_store.h"
#include "policy.h"
#include <QtTest>
class PolicyTest : public QObject {
  Q_OBJECT
private slots:
  void grants() {
    Aevra::Policy p;
    QVERIFY(!p.authorized(":1.2"));
    p.grant("first");
    p.open(":1.2");
    QVERIFY(p.authorized(":1.2"));
    p.revoke();
    QVERIFY(!p.authorized(":1.2"));
    p.grant("first");
    QVERIFY(!p.open(":1.2"));
    p.grant("second");
    QVERIFY(p.open(":1.2"));
    p.close(":1.2");
    QVERIFY(!p.authorized(":1.2"));
  }
  void restart() {
    QTemporaryDir directory;
    auto file = directory.filePath("accepted-grant");
    Aevra::GrantStore first(file);
    QVERIFY(first.accept("fresh-approval-nonce"));
    Aevra::GrantStore restarted(file);
    QVERIFY(!restarted.accept("fresh-approval-nonce"));
    QVERIFY(restarted.accept("another-fresh-approval"));
    QVERIFY(!restarted.accept("fresh-approval-nonce"));
  }
  void targets() {
    QVERIFY(Aevra::validTarget(2, 10, true, 2, 10));
    QVERIFY(!Aevra::validTarget(2, 10, false, 2, 10));
    QVERIFY(!Aevra::validTarget(2, 10, true, 3, 10));
    QVERIFY(!Aevra::validTarget(2, 10, true, 2, 11));
    QVERIFY(!Aevra::validTarget(0, 10, true, 0, 10));
    QVERIFY(Aevra::validPoint(100, 400, 400, 240, 110, 410));
    QVERIFY(!Aevra::validPoint(100, 400, 400, 240, 500, 410));
    QVERIFY(Aevra::validPoint(100, 400, 400, 240, 110.5, 410));
    QVERIFY(!Aevra::validMovePoint(100, 400, 400, 240, 110.5, 410));
    QVERIFY(Aevra::validMovePoint(100, 400, 400, 240, 110, 410));
    QVERIFY(!Aevra::validPoint(100, 400, 400, 240, qQNaN(), 410));
  }
};
QTEST_GUILESS_MAIN(PolicyTest)
#include "policy_test.moc"
