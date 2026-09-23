import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "./env";

const LOGIN_PATH = "/login";
const OWNER_LOGIN_PATH = "/owner/login";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isOwnerZone = pathname === OWNER_LOGIN_PATH || pathname.startsWith("/owner/") || pathname === "/owner";
  const isLoginPath = pathname === LOGIN_PATH || pathname === OWNER_LOGIN_PATH;

  if (!user && !isLoginPath) {
    if (isOwnerZone) {
      return NextResponse.redirect(new URL(OWNER_LOGIN_PATH, request.url));
    }
    const redirectUrl = new URL(LOGIN_PATH, request.url);
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && pathname === LOGIN_PATH) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (user && pathname === OWNER_LOGIN_PATH) {
    return NextResponse.redirect(new URL("/owner", request.url));
  }

  return response;
}
