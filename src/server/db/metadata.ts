import { dbClient } from "./index";

export async function hasTable(tableName: string) {
  const result = await dbClient.execute({
    sql: "select 1 from sqlite_master where type = 'table' and name = ? limit 1",
    args: [tableName],
  });

  return result.rows.length > 0;
}
