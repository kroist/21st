"use client"

import React, { useState, useEffect, useRef } from "react"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { useRouter } from "next/navigation"
import { uploadToR2 } from "../../utils/r2"
import {
  formSchema,
  FormData,
  isFormValid,
  prepareFilesForPreview,
} from "./utils"
import {
  extractComponentNames,
  extractDependencies,
  extractDemoComponentName,
  findInternalDependencies,
  removeComponentImports,
  wrapExportInBraces,
  removeAsyncFromExport,
} from "../../utils/parsers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"

import { addTagsToComponent } from "@/utils/dbQueries"

import { ComponentDetails, ComponentDetailsRef } from "./ComponentDetails"
import { motion, AnimatePresence } from "framer-motion"
import Image from "next/image"
import { FileTerminal, SunMoon, Codepen } from "lucide-react"
import { useClerkSupabaseClient } from "@/utils/clerk"
import { useUser } from "@clerk/nextjs"
import { useDebugMode } from "@/hooks/useDebugMode"
import { Tag } from "@/types/global"
import { Preview } from "./preview"
import { Hotkey } from "../ui/hotkey"
import { useTheme } from "next-themes"
import { cn } from "@/lib/utils"

export default function ComponentForm() {
  const { theme } = useTheme()
  const isDarkTheme = theme === "dark"

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      component_slug: "",
      code: "",
      demo_code: "",
      description: "",
      tags: [],
      license: "mit",
    },
  })

  const isDebug = useDebugMode()
  const [isSuccessDialogOpen, setIsSuccessDialogOpen] = useState(false)
  const [componentDependencies, setComponentDependencies] = useState<{
    dependencies: Record<string, string>
    demoDependencies: Record<string, string>
    internalDependencies: Record<string, string>
    componentNames: string[]
    demoComponentName: string
  }>({
    dependencies: {},
    demoDependencies: {},
    internalDependencies: {},
    componentNames: [],
    demoComponentName: "",
  })

  const {
    dependencies: parsedDependencies,
    demoDependencies: parsedDemoDependencies,
    internalDependencies: internalDependencies,
    componentNames: parsedComponentNames,
    demoComponentName: parsedDemoComponentName,
  } = componentDependencies || {}

  const {
    component_slug: componentSlug,
    code,
    demo_code: demoCode,
    tags: validTags,
  } = form.getValues()

  const { user } = useUser()
  const client = useClerkSupabaseClient()
  const router = useRouter()
  const [showComponentDetails, setShowComponentDetails] = useState(false)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [importsToRemove, setImportsToRemove] = useState<string[] | undefined>(
    undefined,
  )

  const componentDetailsRef = useRef<ComponentDetailsRef>(null)

  useEffect(() => {
    if (showComponentDetails && componentDetailsRef.current) {
      componentDetailsRef.current.focusNameInput()
    }
  }, [showComponentDetails])

  useEffect(() => {
    const updateDependencies = () => {
      try {
        const componentNames = extractComponentNames(code)
        const dependencies = extractDependencies(code)
        const demoDependencies = extractDependencies(demoCode)
        const demoComponentName = extractDemoComponentName(demoCode)
        const internalDependencies = findInternalDependencies(code, demoCode)

        setComponentDependencies({
          dependencies,
          demoDependencies,
          componentNames,
          demoComponentName,
          internalDependencies,
        })
      } catch (error) {
        console.error("Error updating dependencies:", error)
      }
    }

    updateDependencies()
  }, [code, demoCode])

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert("File is too large. Maximum size is 5 MB.")
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        setPreviewImage(e.target?.result as string)
      }
      reader.readAsDataURL(file)

      form.setValue("preview_url", file)
    }
  }

  const onSubmit = async (data: FormData) => {
    if (!user || !user.id) {
      console.error("User is not authenticated")
      alert("You must be logged in to add a component.")
      return
    }

    if (Object.values(internalDependencies ?? {}).some((slug) => !slug)) {
      console.error("Internal dependencies not specified")
      alert("Please specify the slug for all internal dependencies")
      return
    }

    setIsLoading(true)
    try {
      const componentNames = parsedComponentNames
      const demoComponentName = parsedDemoComponentName
      const dependencies = parsedDependencies

      const cleanedDemoCode = demoCode

      const codeFileName = `${data.component_slug}.tsx`
      const demoCodeFileName = `${data.component_slug}.demo.tsx`

      const [codeUrl, demoCodeUrl] = await Promise.all([
        uploadToR2({
          file: {
            name: codeFileName,
            type: "text/plain",
            textContent: data.code,
          },
          fileKey: `${user.id}/${codeFileName}`,
          bucketName: "components-code",
        }),
        uploadToR2({
          file: {
            name: demoCodeFileName,
            type: "text/plain",
            textContent: cleanedDemoCode,
          },
          fileKey: `${user.id}/${demoCodeFileName}`,
          bucketName: "components-code",
        }),
      ])

      let previewImageUrl = ""
      if (data.preview_url) {
        const fileExtension = data.preview_url.name.split(".").pop()
        const fileKey = `${user.id}/${componentSlug}.${fileExtension}`
        const buffer = Buffer.from(await data.preview_url.arrayBuffer())
        const base64Content = buffer.toString("base64")
        previewImageUrl = await uploadToR2({
          file: {
            name: fileKey,
            type: data.preview_url.type,
            encodedContent: base64Content,
          },
          fileKey,
          bucketName: "components-code",
          contentType: data.preview_url.type,
        })
      }

      const componentData = {
        name: data.name,
        component_names: JSON.stringify(componentNames),
        demo_component_names: JSON.stringify(demoComponentName),
        component_slug: data.component_slug,
        code: codeUrl,
        demo_code: demoCodeUrl,
        description: data.description,
        user_id: user?.id,
        dependencies: JSON.stringify(dependencies),
        demo_dependencies: JSON.stringify(parsedDemoDependencies),
        internal_dependencies: JSON.stringify(internalDependencies),
        preview_url: previewImageUrl,
      }

      const { data: insertedComponent, error } = await client
        .from("components")
        .insert(componentData)
        .select()
        .single()

      if (error) {
        throw error
      }

      if (validTags) {
        await addTagsToComponent(
          client,
          insertedComponent.id,
          validTags.filter((tag) => !!tag.slug) as Tag[],
        )
      }

      if (insertedComponent) {
        setIsSuccessDialogOpen(true)
      }
    } catch (error) {
      console.error("Error adding component:", error)
      let errorMessage = "An error occurred while adding the component"
      if (error instanceof Error) {
        errorMessage += ": " + error.message
      }
      alert(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  const handleGoToComponent = () => {
    if (user) {
      router.push(`/${user.username}/${componentSlug}`)
    }
    setIsSuccessDialogOpen(false)
  }

  const handleAddAnother = () => {
    form.reset()
    setIsSuccessDialogOpen(false)
    setShowComponentDetails(false)
    setPreviewImage(null)
  }

  const [previewProps, setPreviewProps] = useState<{
    files: Record<string, string>
    dependencies: Record<string, string>
  } | null>(null)

  useEffect(() => {
    if (
      code &&
      demoCode &&
      Object.keys(internalDependencies ?? {}).length === 0 &&
      importsToRemove?.length === 0
    ) {
      const { files, dependencies } = prepareFilesForPreview(
        code,
        demoCode,
        isDarkTheme,
      )
      setPreviewProps({ files, dependencies })
    } else {
      setPreviewProps(null)
    }
  }, [code, demoCode, internalDependencies, importsToRemove])

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const formData = form.getValues()
    onSubmit(formData)
  }

  useEffect(() => {
    const keyDownHandler = (e: KeyboardEvent) => {
      if (e.code === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        handleSubmit(e as unknown as React.FormEvent)
      }
    }

    window.addEventListener("keydown", keyDownHandler)

    return () => {
      window.removeEventListener("keydown", keyDownHandler)
    }
  }, [form, internalDependencies, handleSubmit, onSubmit])

  const isPreviewReady =
    !!previewProps &&
    Object.keys(internalDependencies).length === 0 &&
    importsToRemove !== undefined &&
    !!code.length &&
    !!demoCode.length

  const [exportWrapped, setExportWrapped] = useState(false)

  useEffect(() => {
    if (exportWrapped) return

    const code = form.getValues("code")
    if (!code) return

    const modifiedCode = wrapExportInBraces(code)

    if (modifiedCode !== code) {
      form.setValue("code", modifiedCode)
      setExportWrapped(true)
    } else {
      setExportWrapped(true)
    }
  }, [form.watch("code"), exportWrapped])

  useEffect(() => {
    const demoCode = form.getValues("demo_code")
    if (!demoCode) return

    const modifiedDemoCode = removeAsyncFromExport(demoCode)

    if (modifiedDemoCode !== demoCode) {
      form.setValue("demo_code", modifiedDemoCode)
    }
  }, [form.watch("demo_code")])

  useEffect(() => {
    if (!parsedComponentNames) return
    const demoCode = form.getValues("demo_code")
    const { modifiedCode, removedImports } = removeComponentImports(
      demoCode,
      parsedComponentNames,
    )
    setImportsToRemove(removedImports)
    const demoComponentName = extractDemoComponentName(modifiedCode)
    if (demoComponentName) {
      setShowComponentDetails(true)
      form.setValue("demo_code", modifiedCode)
    }
  }, [form.watch("demo_code")])

  const getMainComponentName = () => {
    if (!parsedComponentNames || parsedComponentNames.length === 0) return null

    const capitalizedComponent = parsedComponentNames.find((name) =>
      /^[A-Z]/.test(name),
    )
    if (!capitalizedComponent) return null

    return capitalizedComponent.replace(/([A-Z])/g, " $1").trim()
  }

  const mainComponentName = getMainComponentName()

  const demoCodeTextAreaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (parsedComponentNames?.length && demoCodeTextAreaRef.current) {
      demoCodeTextAreaRef.current.focus()
    }
  }, [parsedComponentNames])

  return (
    <>
      <Form {...form}>
        <form
          onSubmit={(e) => e.preventDefault()}
          className="flex w-full h-full items-center justify-center"
        >
          <AnimatePresence>
            <div className={`flex gap-4 items-center h-full w-full mt-2`}>
              <div
                className={cn(
                  "flex flex-col items-start gap-2 py-10 max-h-[calc(100vh-40px)] px-[2px] overflow-y-auto w-1/3 min-w-[400px]",
                  showComponentDetails &&
                    Object.keys(internalDependencies).length === 0
                    ? "ml-0"
                    : "mx-auto",
                )}
              >
                <FormField
                  control={form.control}
                  name="code"
                  render={({ field }) => (
                    <FormItem className="w-full relative">
                      <FormControl>
                        <motion.div
                          className="relative"
                          animate={{
                            height: isEditMode
                              ? "33vh"
                              : parsedComponentNames?.length
                                ? "56px"
                                : "50px",
                          }}
                          transition={{ duration: 0.3 }}
                        >
                          <Textarea
                            value={field.value}
                            onChange={(e) => {
                              field.onChange(e.target.value)
                              if (e.target.value.trim()) {
                                setIsEditMode(false)
                              }
                            }}
                            className={cn(
                              "mt-1 min-h-[56px] w-full h-full",
                              field.value.length
                                ? ""
                                : "border-none shadow-none text-[20px] bg-transparent",
                            )}
                          />
                          {!parsedComponentNames?.length &&
                            field.value.length === 0 &&
                            !isPreviewReady &&
                            !isEditMode && (
                              <div
                                className={cn(
                                  "absolute inset-0 w-full h-full",
                                  isDarkTheme
                                    ? "text-gray-400"
                                    : "text-gray-600",
                                  "text-[20px] flex items-center justify-center cursor-text",
                                )}
                                onClick={() => {
                                  const textarea =
                                    document.querySelector("textarea")
                                  if (textarea) {
                                    textarea.focus()
                                  }
                                }}
                              >
                                PASTE COMPONENT .TSX CODE HERE
                              </div>
                            )}
                          {!!parsedComponentNames?.length && !isEditMode && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.3 }}
                              className={`absolute p-2 border rounded-md inset-0 bg-background text-foreground bg-opacity-80 backdrop-blur-sm flex items-center justify-start`}
                            >
                              <EditCodeFileCard
                                iconSrc="/tsx-file.svg"
                                mainText={`${mainComponentName} code`}
                                subText={`${parsedComponentNames.slice(0, 2).join(", ")}${parsedComponentNames.length > 2 ? ` +${parsedComponentNames.length - 2}` : ""}`}
                                onEditClick={() => setIsEditMode(true)}
                              />
                            </motion.div>
                          )}
                        </motion.div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {!!parsedComponentNames?.length && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 20 }}
                    transition={{ duration: 0.3, delay: 0.3 }}
                    className="w-full"
                  >
                    <FormField
                      control={form.control}
                      name="demo_code"
                      render={({ field }) => (
                        <FormItem className="w-full relative">
                          {!showComponentDetails && (
                            <FormLabel>PASTE DEMO CODE HERE [⌘ V]</FormLabel>
                          )}
                          <FormControl>
                            <motion.div
                              className="relative"
                              animate={{
                                height: showComponentDetails
                                  ? "56px"
                                  : "calc(100vh/3)",
                              }}
                              transition={{ duration: 0.3 }}
                            >
                              <Textarea
                                ref={demoCodeTextAreaRef}
                                value={field.value}
                                onChange={(e) => {
                                  field.onChange(e.target.value)
                                }}
                                className="mt-1 w-full h-full resize-none"
                                style={{ height: "100%", minHeight: "100%" }}
                              />
                              {showComponentDetails && (
                                <motion.div
                                  initial={{ opacity: 0 }}
                                  animate={{ opacity: 1 }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0.3, delay: 0.3 }}
                                  className="absolute p-2 border rounded-md inset-0 bg-background text-foreground bg-opacity-80 backdrop-blur-sm flex items-center justify-start"
                                >
                                  <EditCodeFileCard
                                    iconSrc="/demo-file.svg"
                                    mainText="Demo code"
                                    subText={`for ${parsedComponentNames[0]}`}
                                    onEditClick={() =>
                                      setShowComponentDetails(false)
                                    }
                                  />
                                </motion.div>
                              )}
                            </motion.div>
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </motion.div>
                )}

                {Object.keys(internalDependencies ?? {}).length > 0 &&
                  showComponentDetails && (
                    <InputInternalDependenciesCard
                      internalDependencies={internalDependencies}
                      setComponentDependencies={setComponentDependencies}
                    />
                  )}

                {isDebug && (
                  <DebugInfoDisplay
                    parsedComponentNames={parsedComponentNames}
                    parsedDemoComponentName={parsedDemoComponentName}
                    parsedDependencies={parsedDependencies}
                    parsedDemoDependencies={parsedDemoDependencies}
                  />
                )}

                {showComponentDetails && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3, delay: 0.3 }}
                    className="w-full"
                  >
                    <ComponentDetails
                      ref={componentDetailsRef}
                      form={form}
                      previewImage={previewImage}
                      handleFileChange={handleFileChange}
                      handleSubmit={handleSubmit}
                      isLoading={isLoading}
                      isFormValid={isFormValid}
                      internalDependencies={internalDependencies ?? {}}
                      componentName={mainComponentName}
                    />
                  </motion.div>
                )}
              </div>

              {previewProps && isPreviewReady && showComponentDetails && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3, delay: 3 }}
                  className="w-2/3 py-4"
                >
                  <React.Suspense fallback={<div>Loading preview...</div>}>
                    <Preview {...previewProps} isDebug={isDebug} />
                  </React.Suspense>
                </motion.div>
              )}
            </div>
          </AnimatePresence>
        </form>
      </Form>
      <SuccessDialog
        isOpen={isSuccessDialogOpen}
        onOpenChange={setIsSuccessDialogOpen}
        onAddAnother={handleAddAnother}
        onGoToComponent={handleGoToComponent}
      />
      {!parsedComponentNames?.length && !isPreviewReady && !isEditMode && (
        <CodeGuidelinesAlert />
      )}
      {!showComponentDetails && !!code.length && (
        <DemoComponentGuidelinesAlert />
      )}
    </>
  )
}

const EditCodeFileCard = ({
  iconSrc,
  mainText,
  subText,
  onEditClick,
}: {
  iconSrc: string
  mainText: string
  subText: string
  onEditClick: () => void
}) => (
  <div className="flex items-center gap-2 w-full">
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center">
        <div className="w-10 h-10 relative mr-2 items-center justify-center">
          <Image
            src={iconSrc}
            width={40}
            height={40}
            alt={`${mainText} File`}
          />
        </div>
        <div className="flex flex-col items-start h-10">
          <p className="font-semibold text-[14px]">{mainText}</p>
          <p className="text-sm text-gray-600 text-[12px]">{subText}</p>
        </div>
      </div>
      <Button onClick={onEditClick}>Edit</Button>
    </div>
  </div>
)

const SuccessDialog = ({
  isOpen,
  onOpenChange,
  onAddAnother,
  onGoToComponent,
}: {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  onAddAnother: () => void
  onGoToComponent: () => void
}) => {
  useEffect(() => {
    const keyDownHandler = (e: KeyboardEvent) => {
      if (isOpen && e.code === "KeyN") {
        e.preventDefault()
        onAddAnother()
      }
      if (isOpen && e.code === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onGoToComponent()
      }
    }

    window.addEventListener("keydown", keyDownHandler)
    return () => {
      window.removeEventListener("keydown", keyDownHandler)
    }
  }, [isOpen, onAddAnother, onGoToComponent])

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Component Added Successfully</DialogTitle>
          <DialogDescription className="break-words">
            Your new component has been successfully added. What would you like
            to do next?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onAddAnother} variant="outline">
            Add Another
            <Hotkey keys={["N"]} />
          </Button>
          <Button onClick={onGoToComponent} variant="default">
            View Component
            <Hotkey keys={["⏎"]} />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const CodeGuidelinesAlert = () => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 20 }}
    transition={{ duration: 0.3 }}
    className="absolute bottom-4 mx-auto"
  >
    <Alert>
      <FileTerminal className="h-4 w-4" />
      <AlertTitle>Entire code should be in a single file</AlertTitle>
      <AlertDescription>
        Ensure to include all necessary dependencies to enable everyone <br />
        to use this component and install it seamlessly via the CLI.
      </AlertDescription>
    </Alert>
  </motion.div>
)

const DemoComponentGuidelinesAlert = () => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: 20 }}
    transition={{ duration: 0.3, delay: 0.3 }}
    className="absolute bottom-4 mx-auto"
  >
    <Alert>
      <SunMoon className="h-4 w-4" />
      <AlertTitle>
        Demo should demonstrate how it functions and appears
      </AlertTitle>
      <AlertDescription>
        Do not add an import statement for the Component,
        <br />
        as it will be imported automatically.
      </AlertDescription>
    </Alert>
  </motion.div>
)

const DebugInfoDisplay = ({
  parsedComponentNames,
  parsedDemoComponentName,
  parsedDependencies,
  parsedDemoDependencies,
}: {
  parsedComponentNames: string[]
  parsedDemoComponentName: string
  parsedDependencies: Record<string, string>
  parsedDemoDependencies: Record<string, string>
}) => (
  <>
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700">
        Component names
      </label>
      <Textarea
        value={parsedComponentNames?.join(", ")}
        readOnly
        className="mt-1 w-full bg-gray-100"
      />
    </div>
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700">
        Demo component name
      </label>
      <Input
        value={parsedDemoComponentName}
        readOnly
        className="mt-1 w-full bg-gray-100"
      />
    </div>
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700">
        Component dependencies
      </label>
      <Textarea
        value={Object.entries(parsedDependencies ?? {})
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")}
        readOnly
        className="mt-1 w-full bg-gray-100"
      />
    </div>
    <div className="w-full">
      <label className="block text-sm font-medium text-gray-700">
        Demo dependencies
      </label>
      <Textarea
        value={Object.entries(parsedDemoDependencies ?? {})
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")}
        readOnly
        className="mt-1 w-full bg-gray-100"
      />
    </div>
  </>
)

const InputInternalDependenciesCard = ({
  internalDependencies,
  setComponentDependencies,
}: {
  internalDependencies: Record<string, string>
  setComponentDependencies: React.Dispatch<
    React.SetStateAction<{
      dependencies: Record<string, string>
      demoDependencies: Record<string, string>
      internalDependencies: Record<string, string>
      componentNames: string[]
      demoComponentName: string
    }>
  >
}) => (
  <div className="w-full">
    <Alert className="my-2">
      <Codepen className="h-4 w-4" />
      <AlertTitle>Component dependencies detected</AlertTitle>
      <AlertDescription>
        To use another component within your component:
        <br />
        1. Add it to the Component Community first.
        <br />
        2. Enter its slug here.
      </AlertDescription>
    </Alert>
    {Object.entries(internalDependencies ?? {}).map(([path], index) => (
      <div key={path} className={`w-full ${index > 0 ? "mt-2" : ""}`}>
        <label className="block text-sm font-medium text-gray-700">
          Add slug for {path}
        </label>
        <Input
          onChange={(e) => {
            setComponentDependencies((prev) => ({
              ...prev,
              internalDependencies: {
                ...prev?.internalDependencies,
                [path]: e.target.value!!,
              },
            }))
          }}
          placeholder="Enter component slug"
          className="mt-1 w-full"
        />
      </div>
    ))}
  </div>
)
