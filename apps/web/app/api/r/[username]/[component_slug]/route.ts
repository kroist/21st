import { supabaseWithAdminAccess } from "@/utils/supabase"
import { NextRequest, NextResponse } from "next/server"
import { ComponentRegistryResponse } from "./types"
import { resolveRegistryDependencyTree } from "@/utils/queries.server"
import { Tables } from "@/types/supabase";

export async function GET(
  request: NextRequest,
  { params }: { params: { username: string; component_slug: string } },
) {
  const { username, component_slug } = params

  try {
    const { data: component, error } = await supabaseWithAdminAccess
      .from("components")
      .select("*, user:users!user_id(*)")
      .eq("component_slug", component_slug)
      .eq("user.username", username)
      .returns<
        (Tables<"components"> & { user: Tables<"users"> })[]
      >()
      .single()


    if (error || !component) {
      return NextResponse.json(
        { error: "Component not found" },
        { status: 404 },
      )
    }

    const dependencies = component.dependencies as Record<string, string>
    const directRegistryDependencies =
      component.direct_registry_dependencies as string[]

    const resolvedRegistryDependencies = await resolveRegistryDependencyTree({
      supabase: supabaseWithAdminAccess,
      sourceDependencySlugs: [
        `${component.user.username}/${component_slug}`,
        ...directRegistryDependencies,
      ],
    })

    if (resolvedRegistryDependencies.error) {
      throw resolvedRegistryDependencies.error
    }

    console.log(resolvedRegistryDependencies.data)

    const files = Object.entries(resolvedRegistryDependencies.data).map(
      ([path, { code, registry }]) => ({
        path,
        content: code,
        type: `registry:${registry}`,
        target: "",
      }),
    )

    const responseData: ComponentRegistryResponse = {
      name: component_slug,
      type: `registry:${component.registry}`,
      dependencies:
        Object.keys(dependencies).length > 0
          ? Object.keys(dependencies)
          : undefined,
      files,
    }

    return NextResponse.json(responseData)
  } catch (error) {
    console.error("Unexpected error:", error)
    const message =
      error instanceof Error ? error.message : "An unexpected error occurred"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
