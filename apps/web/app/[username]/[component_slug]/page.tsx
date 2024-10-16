import ComponentPage from "@/components/ComponentPage"
import React from "react"
import { notFound } from "next/navigation"
import { getComponent } from "@/utils/dbQueries"
import { supabaseWithAdminAccess } from "@/utils/supabase"
import ErrorPage from "@/components/ErrorPage"
import { Json } from "@/types/supabase"

export const generateMetadata = async ({
  params,
}: {
  params: { username: string; component_slug: string }
}) => {
  const { data: component } = await getComponent(
    supabaseWithAdminAccess,
    params.username,
    params.component_slug,
  )
  return {
    title: component ? `${component.name} | Component` : "Component Not Found",
  }
}

export default async function ComponentPageLayout({
  params,
}: {
  params: { username: string; component_slug: string }
}) {
  const { username, component_slug } = params
  const apiUrl = process.env.NEXT_PUBLIC_CDN_URL
  const { data: component, error } = await getComponent(
    supabaseWithAdminAccess,
    username,
    component_slug,
  )

  if (error) {
    return <ErrorPage error={error} />
  }

  if (!component) {
    notFound()
  }

  const dependencies = (component.dependencies ?? {}) as Record<string, string>
  const demoDependencies = (component.demo_dependencies ?? {}) as Record<string, string>
  const internalDependencies = (component.internal_dependencies ?? {}) as Record<string, string>

  const componentAndDemoCodePromises = [
    fetch(component.code).then(async (response) => {
      if (!response.ok) {
        console.error(`Error loading component code:`, response.statusText)
        return { data: null, error: new Error(response.statusText) }
      }
      const code = await response.text()
      return { data: code, error: null }
    }),
    fetch(component.demo_code).then(async (response) => {
      if (!response.ok) {
        console.error(`Error loading component demo code:`, response.statusText)
        return { data: null, error: new Error(response.statusText) }
      }
      const demoCode = await response.text()
      return { data: demoCode, error: null }
    }),
  ]

  const internalDependenciesPromises = Object.entries(
    internalDependencies,
  ).flatMap(([path, slugs]) => {
    const slugArray = Array.isArray(slugs) ? slugs : [slugs]
    return slugArray.map(async (slug) => {
      const dependencyUrl = `${apiUrl}/${component.user_id}/${slug}.tsx`
      const response = await fetch(dependencyUrl)
      if (!response.ok) {
        console.error(
          `Error downloading file for ${slug}:`,
          response.statusText,
        )
        return { data: null, error: new Error(response.statusText) }
      }

      const code = await response.text()
      if (!code) {
        console.error(
          `Error loading internal dependency ${slug}: No code returned`,
        )
        return { data: null, error: new Error("No code returned") }
      }
      const fullPath = path.endsWith(".tsx") ? path : `${path}.tsx`
      return { data: { [fullPath]: code }, error: null }
    })
  })

  const [codeResult, demoResult, ...internalDependenciesResults] =
    await Promise.all([
      ...componentAndDemoCodePromises,
      ...internalDependenciesPromises,
    ])

  if (codeResult?.error || demoResult?.error) {
    return (
      <ErrorPage
        error={
          new Error(
            `Error fetching component code: ${codeResult?.error?.message || demoResult?.error?.message}`,
          )
        }
      />
    )
  }
  const errorResult = internalDependenciesResults?.find(
    (result) => result?.error,
  )
  if (errorResult) {
    const errorMessage = errorResult.error?.message || "Unknown error"
    return (
      <ErrorPage
        error={
          new Error(`Error fetching internal dependencies: ${errorMessage}`)
        }
      />
    )
  }

  const internalDependenciesWithCode = internalDependenciesResults
    .filter((result) => typeof result?.data === "object")
    .reduce(
      (acc, result): Record<string, string> => {
        if (result?.data && typeof result.data === "object") {
          return { ...acc, ...result.data }
        }
        return acc
      },
      {} as Record<string, string>,
    )

  const code = codeResult?.data as string
  const rawDemoCode = demoResult?.data as string

  const componentNames = component.component_names! as string[]

  const hasUseClient = /^"use client";?\s*/.test(rawDemoCode)

  const importStatements = `import { ${componentNames.join(", ")} } from "./${component.component_slug}";\n`

  const demoCode = hasUseClient
    ? `"use client";\n${importStatements}\n${rawDemoCode.replace(/^"use client";?\s*/, "")}`
    : `${importStatements}\n${rawDemoCode}`

  const demoComponentName = (component.demo_component_names as string[])[0]!

  return (
    <div className="w-full ">
      <ComponentPage
        component={component}
        code={code}
        demoCode={demoCode}
        dependencies={dependencies}
        demoDependencies={demoDependencies}
        demoComponentName={demoComponentName}
        internalDependencies={internalDependenciesWithCode}
      />
    </div>
  )
}
