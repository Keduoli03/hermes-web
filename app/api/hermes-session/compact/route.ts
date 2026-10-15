import { compressHermesSession } from "@/lib/hermes-session-rpc.mjs";
import { isValidWebSessionToken, isWebAuthEnabled, PI_WEB_SESSION_COOKIE } from "@/lib/web-auth";
import { isApiRequestAllowed, isLocalWebDevelopment } from "@/lib/request-security";
import { projectRpcOptions } from "@/lib/hermes-project-request";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({error:"请求来源不允许。"},{status:403});
  const cookie=request.headers.get("cookie")?.split(";").map(item=>item.trim()).find(item=>item.startsWith(`${PI_WEB_SESSION_COOKIE}=`))?.slice(PI_WEB_SESSION_COOKIE.length+1);
  const loopback=isLocalWebDevelopment(request);
  if (!isValidWebSessionToken(cookie) && (isWebAuthEnabled() || !loopback)) return Response.json({error:"Authentication required"},{status:401});
  const body=await request.json().catch(()=>null);
  if (!body || typeof body.session_id!=="string" || !/^[A-Za-z0-9_.-]{1,160}$/.test(body.session_id)) return Response.json({error:"会话 ID 无效。"},{status:400});
  try {return Response.json(await compressHermesSession(body.session_id,await projectRpcOptions(request.signal)),{headers:{"Cache-Control":"no-store"}});}
  catch(error) {return Response.json({error:error instanceof Error?error.message:"Hermes 压缩失败。"},{status:502});}
}
