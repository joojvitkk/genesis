// P6 — fuso horário + starts_at derivado + blind_version nos torneios existentes.
const { computeStartsAt, DEFAULT_TZ } = require('../lib/datetime');

module.exports = {
  async up(db) {
    const cursor = db.collection('tournaments').find({});
    while (await cursor.hasNext()) {
      const t = await cursor.next();
      const timezone = t.timezone || DEFAULT_TZ;
      await db.collection('tournaments').updateOne(
        { _id: t._id },
        {
          $set: {
            timezone,
            blind_version: t.blind_version || 0,
            starts_at: computeStartsAt(t.date, t.start_time, timezone),
          },
        }
      );
    }
  },
  async down(db) {
    await db.collection('tournaments').updateMany({}, {
      $unset: { timezone: '', starts_at: '', blind_version: '' },
    });
  },
};
