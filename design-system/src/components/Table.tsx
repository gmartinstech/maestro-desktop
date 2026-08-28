import type { ReactNode } from 'react';
import { cx } from '../cx';

export interface TableColumn<Row> {
  /** Stable key, also used as the React key for the cell. */
  key: string;
  /** Column heading — rendered uppercase and tracked out. */
  header: string;
  /** Cell renderer. Return a string for plain text or JSX for badges and avatars. */
  render: (row: Row) => ReactNode;
  /** Right-aligns and switches the cell to tabular mono — use for every numeric column. */
  numeric?: boolean;
  width?: string;
}

export interface TableProps<Row> {
  columns: TableColumn<Row>[];
  rows: Row[];
  /** Stable row identity. Defaults to the row index. */
  rowKey?: (row: Row, index: number) => string;
  /** Shown in place of the body when `rows` is empty. */
  empty?: ReactNode;
  className?: string;
}

/** Dense data table. Wrap it in a flush Card to get the panel treatment the app uses. */
export function Table<Row>({ columns, rows, rowKey, empty, className }: TableProps<Row>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }
  return (
    <div className="mds-table-wrap">
      <table className={cx('mds-table', className)}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} style={{ width: c.width, textAlign: c.numeric ? 'right' : 'left' }}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : String(i)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'mds-table__num' : undefined}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
