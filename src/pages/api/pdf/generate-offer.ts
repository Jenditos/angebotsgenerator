import type { NextApiRequest, NextApiResponse } from "next";
import { POST as handleGenerateOffer } from "@/app/api/generate-offer/route";
import {
  buildWebRequestFromApiRequest,
  sendWebResponseToApiResponse,
} from "@/server/pages-api-bridge";

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const response = await handleGenerateOffer(
    buildWebRequestFromApiRequest(req, "http://localhost:3003/api/generate-offer"),
  );

  await sendWebResponseToApiResponse(response, res);
}
