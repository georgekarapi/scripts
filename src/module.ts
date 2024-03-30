import { addBuildPlugin, addImports, addImportsDir, addPlugin, addPluginTemplate, addTemplate, createResolver, defineNuxtModule } from '@nuxt/kit'
import { readPackageJSON } from 'pkg-types'
import type { Import } from 'unimport'
import type { Input } from 'valibot'
import type { NuxtUseScriptInput, NuxtUseScriptOptions } from './runtime/types'
import { setupDevToolsUI } from './devtools'
import { NuxtScriptAssetBundlerTransformer } from './plugins/transform'
import { setupPublicAssetStrategy } from './assets'
import { logger } from './logger'
import type { CloudflareWebAnalyticsOptions } from './runtime/registry/cloudflare-web-analytics'
import { extendTypes } from './kit'

export interface ModuleOptions {
  /**
   * Register scripts globally.
   */
  register?: {
    cloudflareWebAnalytics?: Input<typeof CloudflareWebAnalyticsOptions>
    // TODO start the rest
  }
  /**
   * Register scripts that should be loaded globally on all pages.
   */
  globals?: (NuxtUseScriptInput | [NuxtUseScriptInput, NuxtUseScriptOptions])[]
  /**
   * Override the static script options for specific scripts based on their provided `key` or `src`.
   */
  overrides?: {
    [key: string]: Pick<NuxtUseScriptOptions, 'assetStrategy'>
  }
  /** Configure the way scripts assets are exposed */
  assets?: {
    /**
     * The baseURL where scripts files are served.
     * @default '/_scripts/'
     */
    prefix?: string
    /** Currently scripts assets are exposed as public assets as part of the build. This will be configurable in future */
    strategy?: 'public'
  }
  /**
   * Whether the module is enabled.
   *
   * @default true
   */
  enabled: boolean
  /**
   * Enables debug mode.
   *
   * @false false
   */
  debug: boolean
}

export interface ModuleHooks {
  /**
   * Transform a script before it's registered.
   */
  'scripts:transform': (ctx: { script: string, options: any }) => Promise<void>
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@nuxt/scripts',
    configKey: 'scripts',
    compatibility: {
      nuxt: '^3.11.1',
      bridge: false,
    },
  },
  defaults: {
    enabled: true,
    debug: false,
  },
  async setup(config, nuxt) {
    const { resolve } = createResolver(import.meta.url)
    const { version, name } = await readPackageJSON(resolve('../package.json'))
    if (!config.enabled) {
      // TODO fallback to useHead?
      logger.debug('The module is disabled, skipping setup.')
      return
    }
    // allow augmenting the options
    nuxt.options.alias['#nuxt-scripts'] = resolve('./runtime/types')
    nuxt.options.runtimeConfig['nuxt-scripts'] = { version }
    addImportsDir([
      resolve('./runtime/composables'),
    ])

    const registry: Import[] = [
      {
        name: 'useScriptCloudflareTurnstile',
        from: resolve('./runtime/registry/cloudflare-turnstile'),
      },
      {
        name: 'useScriptCloudflareWebAnalytics',
        from: resolve('./runtime/registry/cloudflare-web-analytics'),
      },
      {
        name: 'useScriptConfetti',
        from: resolve('./runtime/registry/confetti'),
      },
      {
        name: 'useScriptFacebookPixel',
        from: resolve('./runtime/registry/facebook-pixel'),
      },
      {
        name: 'useScriptFathomAnalytics',
        from: resolve('./runtime/registry/fathom-analytics'),
      },
      {
        name: 'useScriptGoogleAnalytics',
        from: resolve('./runtime/registry/google-analytics'),
      },
      {
        name: 'useScriptGoogleTagManager',
        from: resolve('./runtime/registry/google-tag-manager'),
      },
      {
        name: 'useScriptHotjar',
        from: resolve('./runtime/registry/hotjar'),
      },
      {
        name: 'useScriptIntercom',
        from: resolve('./runtime/registry/intercom'),
      },
      {
        name: 'useScriptSegment',
        from: resolve('./runtime/registry/segment'),
      },
    ].map((i: Import) => {
      i.priority = -1
      return i
    })
    addImports(registry)

    const hasRegister = Object.keys(config.register || {}).length > 0
    if (hasRegister) {
      addPluginTemplate({
        filename: 'third-party.mjs',
        write: true,
        getContents() {
          const imports = ['import { defineNuxtPlugin } from "#imports";']
          const inits = []
          // for global scripts, we can initialise them script away
          for (const [k, c] of Object.entries(config.register || {})) {
            // lazy module resolution
            const importPath = resolve(`./runtime/composables/${k}`)
            // title case
            const exportName = k.substring(0, 1).toUpperCase() + k.substring(1)
            imports.unshift(`import { ${exportName} } from "${importPath}";`)
            inits.push(`${exportName}(${JSON.stringify(c)});`)
          }
          return [
            imports.join('\n'),
            '',
            'export default defineNuxtPlugin({',
            '  name: "nuxt-third-party",',
            '  setup() {',
            inits.map(i => `    ${i}`).join('\n'),
            '  }',
            '})',
          ].join('\n')
        },
      })
    }

    if (config.globals?.length) {
      // create a virtual plugin
      const template = addTemplate({
        filename: 'modules/nuxt-scripts/plugin.client.mjs',
        getContents() {
          return `import { defineNuxtPlugin, useScript } from '#imports'
export default defineNuxtPlugin({
  setup() {
${config.globals?.map(g => !Array.isArray(g)
            ? `    useScript("${g.toString()}")`
            : g.length === 2
              ? `    useScript(${JSON.stringify(g[0])}, ${JSON.stringify(g[1])} })`
              : `    useScript(${JSON.stringify(g[0])})`).join('\n')}
  }
})`
        },
      })
      addPlugin({
        src: template.dst,
        mode: 'client',
      })
    }

    extendTypes(name!, async () => {
      return `
declare module '#app' {
    interface NuxtApp {
      ${nuxt.options.dev ? `_scripts: (import('#nuxt-scripts').NuxtAppScript)[]` : ''}
    }
}
`
    })

    const scriptMap = new Map<string, string>()
    const { normalizeScriptData } = setupPublicAssetStrategy(config.assets)

    addBuildPlugin(NuxtScriptAssetBundlerTransformer({
      overrides: config.overrides,
      resolveScript(src) {
        if (scriptMap.has(src))
          return scriptMap.get(src) as string
        const url = normalizeScriptData(src)
        scriptMap.set(src, url)
        return url
      },
    }))

    if (nuxt.options.dev)
      setupDevToolsUI(config, resolve)
  },
})
