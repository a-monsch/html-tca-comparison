import os
import json

def build_folder_structure(root_dir, base_path=""):
    structure = {}
    
    if not os.path.exists(root_dir):
        print(f"Directory {root_dir} not found. Please create it and add your JSON files.")
        return structure

    for item in sorted(os.listdir(root_dir)):
        item_path = os.path.join(root_dir, item)
        if os.path.isdir(item_path):
            sub_struct = build_folder_structure(item_path, os.path.join(base_path, item) if base_path else item)
            if sub_struct:  # Only add if the folder is not empty
                structure[item] = sub_struct
        elif item.endswith(".json") and item != "folder_structure.json":
            if 'files' not in structure:
                structure['files'] =[]
            structure['files'].append(item)
            
    return structure

data_dir = "./data" 
folder_structure = build_folder_structure(data_dir)

with open("folder_structure.json", "w") as f:
    json.dump(folder_structure, f, indent=4)

print(f"Generated folder_structure.json containing {len(folder_structure.keys())} root keys.")
