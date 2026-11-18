/** CSS module names emitted by the browser bundle. */
declare module '*.module.css' {
  const classes: Record<string, string>
  export default classes
}

/** Package artwork the browser bundle serves through the client asset route. */
declare module '*.png' {
  const url: string
  export default url
}
