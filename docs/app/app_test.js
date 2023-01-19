importScripts("https://cdn.jsdelivr.net/pyodide/v0.21.3/full/pyodide.js");

function sendPatch(patch, buffers, msg_id) {
  self.postMessage({
    type: 'patch',
    patch: patch,
    buffers: buffers
  })
}

async function startApplication() {
  console.log("Loading pyodide!");
  self.postMessage({type: 'status', msg: 'Loading pyodide'})
  self.pyodide = await loadPyodide();
  self.pyodide.globals.set("sendPatch", sendPatch);
  console.log("Loaded!");
  await self.pyodide.loadPackage("micropip");
  const env_spec = ['https://cdn.holoviz.org/panel/0.14.2/dist/wheels/bokeh-2.4.3-py3-none-any.whl', 'https://cdn.holoviz.org/panel/0.14.2/dist/wheels/panel-0.14.2-py3-none-any.whl', 'pyodide-http==0.1.0', 'dateutil', 'holoviews>=1.15.1', 'hvplot', 'numpy', 'pandas']
  for (const pkg of env_spec) {
    let pkg_name;
    if (pkg.endsWith('.whl')) {
      pkg_name = pkg.split('/').slice(-1)[0].split('-')[0]
    } else {
      pkg_name = pkg
    }
    self.postMessage({type: 'status', msg: `Installing ${pkg_name}`})
    try {
      await self.pyodide.runPythonAsync(`
        import micropip
        await micropip.install('${pkg}');
      `);
    } catch(e) {
      console.log(e)
      self.postMessage({
	type: 'status',
	msg: `Error while installing ${pkg_name}`
      });
    }
  }
  console.log("Packages loaded!");
  self.postMessage({type: 'status', msg: 'Executing code'})
  const code = `
  
import asyncio

from panel.io.pyodide import init_doc, write_doc

init_doc()

# Dataframes Utils
import pandas as pd
import numpy as np

# Datetime Utils
import datetime as dt
from dateutil.relativedelta import relativedelta

# Dashboard and DataViz Utils
import panel as pn
import hvplot.pandas
from bokeh.models.formatters import DatetimeTickFormatter

# Pandas Query and preprocessing
orders = pd.read_csv('orders.csv', delimiter='|')
orders['date'] = pd.to_datetime(orders['date']).dt.date

# Make Dynamic Dataframe
idf = orders.interactive()

# Some prints
print(type(orders))
print('Number of valid observations: ' + str(len(orders)))

# Set at 6 last months
min_date = orders['date'].min()
max_date = orders['date'].max()
last_6 = max_date + relativedelta(months=-6)

# Date Range Widget
pn.extension()
date_slider = pn.widgets.DateSlider(name='Start Date', start=min_date, end=max_date, value=last_6, direction= 'ltr')

#Data pipeline
orders_pipeline = (idf[idf['date'] >= date_slider]).sort_values(by='date')

#Date axis formatter
formatter = DatetimeTickFormatter(months='%b %Y')

#Time Series Plot
orders_ts = orders_pipeline.hvplot(x='date', y='amount', by= 'isMultidelivery',
                 kind='line',
                 ylabel='Amount ($)',
                 xformatter=formatter,
                 hover_cols=['date','tip','discount', 'extraCharge'])

# Layout using Template
template = pn.template.VanillaTemplate(
    title = 'Airpals Metrics Dashboard',
    sidebar = [date_slider],
    main = [pn.Row(orders_ts.panel(width=600))],
    accent_base_color = '#88d8b0',
    header_background = '#88d8b0')
    
# Dashboard show
template.servable();

await write_doc()
  `

  try {
    const [docs_json, render_items, root_ids] = await self.pyodide.runPythonAsync(code)
    self.postMessage({
      type: 'render',
      docs_json: docs_json,
      render_items: render_items,
      root_ids: root_ids
    })
  } catch(e) {
    const traceback = `${e}`
    const tblines = traceback.split('\n')
    self.postMessage({
      type: 'status',
      msg: tblines[tblines.length-2]
    });
    throw e
  }
}

self.onmessage = async (event) => {
  const msg = event.data
  if (msg.type === 'rendered') {
    self.pyodide.runPythonAsync(`
    from panel.io.state import state
    from panel.io.pyodide import _link_docs_worker

    _link_docs_worker(state.curdoc, sendPatch, setter='js')
    `)
  } else if (msg.type === 'patch') {
    self.pyodide.runPythonAsync(`
    import json

    state.curdoc.apply_json_patch(json.loads('${msg.patch}'), setter='js')
    `)
    self.postMessage({type: 'idle'})
  } else if (msg.type === 'location') {
    self.pyodide.runPythonAsync(`
    import json
    from panel.io.state import state
    from panel.util import edit_readonly
    if state.location:
        loc_data = json.loads("""${msg.location}""")
        with edit_readonly(state.location):
            state.location.param.update({
                k: v for k, v in loc_data.items() if k in state.location.param
            })
    `)
  }
}

startApplication()