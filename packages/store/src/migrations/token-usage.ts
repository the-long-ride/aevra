export const tokenUsageMigrations = [
  {
    version: 25,
    name: '025_token_usage',
    sql: `
CREATE TABLE IF NOT EXISTS token_usage(
  granularity TEXT NOT NULL CHECK(granularity IN ('hour','day')),
  bucket TEXT NOT NULL,
  connector TEXT NOT NULL,
  tool TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  saved_tokens INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(granularity, bucket, connector, tool)
) WITHOUT ROWID;
`,
  },
];
