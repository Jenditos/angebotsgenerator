import type { NextApiRequest, NextApiResponse } from "next";
import { NextResponse } from "next/server";
import handler from "@/pages/api/pdf/generate-offer";
import { handleGenerateOfferAuthorizedRequest } from "@/app/api/generate-offer/route";

jest.mock("@/app/api/generate-offer/route", () => ({
  handleGenerateOfferAuthorizedRequest: jest.fn(),
}));

jest.mock("@/lib/access/auth-bypass", () => ({
  buildBypassUser: () => ({ id: "bypass-user-id" }),
  isAuthBypassEnabled: () => true,
}));

jest.mock("@/server/pages-api-bridge", () => ({
  buildWebRequestFromApiRequest: jest.fn(
    () => new Request("http://localhost:3003/api/generate-offer"),
  ),
  sendWebResponseToApiResponse: jest.fn(
    async (response: Response, res: NextApiResponse) => {
      res.status(response.status).json(await response.json());
    },
  ),
}));

const handleGenerateOfferAuthorizedRequestMock = jest.mocked(
  handleGenerateOfferAuthorizedRequest,
);

describe("pages api pdf generate-offer", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("passes the bypass user id to the app-route handler in local bypass mode", async () => {
    handleGenerateOfferAuthorizedRequestMock.mockImplementation(
      async () => NextResponse.json({ error: "test response" }),
    );

    const req = {
      method: "POST",
      headers: {},
      body: {},
    } as NextApiRequest;
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
      setHeader: jest.fn(),
      send: jest.fn(),
    } as unknown as NextApiResponse;

    await handler(req, res);

    expect(handleGenerateOfferAuthorizedRequestMock).toHaveBeenCalledWith(
      expect.any(Request),
      { userId: "bypass-user-id" },
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ error: "test response" });
  });
});
