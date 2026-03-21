import pandas as pd, os
path = 'data.xlsx'
print('exists', os.path.exists(path))
xls = pd.ExcelFile(path)
print('sheets', xls.sheet_names)
for s in xls.sheet_names:
    df = pd.read_excel(xls, s)
    print('sheet', s, 'shape', df.shape)
    print(df.head(5).to_dict('list'))
