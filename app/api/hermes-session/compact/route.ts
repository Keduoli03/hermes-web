import { compressHermesSession } from "@/lib/hermes-session-rpc.mjs";
import { isValidWebSessionToken, isWebPasswordEnabled, PI_WEB_SESSION_COOKIE } from "@/lib/web-auth";
import { isApiRequestAllowed } from "@/lib/request-security";

export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!isApiRequestAllowed(request)) return Response.json({error:"请求来源不允许。"},{status:403});
  const cookie=request.headers.get("cookie")?.split(";").map(item=>item.trim()).find(item=>item.startsWith(`${PI_WEB_SESSION_COOKIE}=`))?.slice(PI_WEB_SESSION_COOKIE.length+1);
  const loopback=["localhost","127.0.0.1","[::1]"].includes(new URL(request.url).hostname);
  if (!isValidWebSessionToken(cookie) && (isWebPasswordEnabled() || !loopback)) return Response.json({error:"Authentication required"},{status:401});
  const body=await request.json().catch(()=>null);
  if (!body || typeof body.session_id!=="string" || !/^[A-Za-z0-9_.-]{1,160}$/.test(body.session_id)) return Response.json({error:"会话 ID 无效。"},{status:400});
  const token=process.env.HERMES_DASHBOARD_SESSION_TOKEN?.trim();
  if (!token) return Response.json({error:"尚未配置 Hermes 管理服务的认证令牌。"},{status:503});
  try {return Response.json(await compressHermesSession(body.session_id,{signal:request.signal,token,dashboardUrl:process.env.HERMES_DASHBOARD_URL ?? "http://127.0.0.1:8648"}),{headers:{"Cache-Control":"no-store"}});}
  catch(error) {return Response.json({error:error instanceof Error?error.message:"Hermes 压缩失败。"},{status:502});}
}
