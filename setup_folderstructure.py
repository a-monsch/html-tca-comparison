import os
import json

def build_folder_structure(root_dir, base_path=""):
    structure = {}
    for item in os.listdir(root_dir):
        item_path = os.path.join(root_dir, item)
        if os.path.isdir(item_path):
            # Recursively build structure for subdirectories
            structure[item] = build_folder_structure(item_path, os.path.join(base_path, item) if base_path else item)
        elif item.endswith(".csv"):
            # Store CSV files in a 'files' array at the current level
            if 'files' not in structure:
                structure['files'] = []
            structure['files'].append(item)
    return structure

data_dir = "./data"
folder_structure = build_folder_structure(data_dir)

# Save to a JSON file
with open("folder_structure.json", "w") as f:
    json.dump(folder_structure, f, indent=4)
print(json.dumps(folder_structure, indent=4))
