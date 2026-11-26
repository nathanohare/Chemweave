// Background worker for HRMS report files (mzML, mzXML, CSV, Excel…): a 200 MB data file takes
// seconds to read, which would freeze the SI Project tab on the main thread.

import '../old-webkit';
import { readReportBytes, type ReportData } from '../si/ms-reports';

export interface ReportRequest { id: number; bytes: Uint8Array; name: string }
export interface ReportResponse { id: number; data: ReportData }

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (e: MessageEvent<ReportRequest>) => {
  const { id, bytes, name } = e.data;
  scope.postMessage({ id, data: readReportBytes(bytes, name) } satisfies ReportResponse);
};
