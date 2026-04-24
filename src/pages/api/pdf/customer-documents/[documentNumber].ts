import type { NextRequest } from "next/server";
import type { NextApiRequest, NextApiResponse } from "next";
import { GET as handleCustomerDocument } from "@/app/api/customer-documents/[documentNumber]/route";
import {
  buildWebRequestFromApiRequest,
  sendWebResponseToApiResponse,
} from "@/server/pages-api-bridge";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const rawDocumentNumber = Array.isArray(req.query.documentNumber)
    ? req.query.documentNumber[0]
    : req.query.documentNumber;
  const safeDocumentNumber = encodeURIComponent((rawDocumentNumber || "").trim());
  const response = await handleCustomerDocument(
    buildWebRequestFromApiRequest(
      req,
      `http://localhost:3003/api/customer-documents/${safeDocumentNumber}`,
    ) as NextRequest,
    {
      params: Promise.resolve({
        documentNumber: rawDocumentNumber || "",
      }),
    },
  );

  await sendWebResponseToApiResponse(response, res);
}
