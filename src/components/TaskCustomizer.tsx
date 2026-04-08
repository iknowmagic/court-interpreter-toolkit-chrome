import React, { useState } from "react";
import type { PracticeTemplateTask } from "@shared/practice";
import { createTaskId } from "@shared/practice";

interface TaskCustomizerProps {
  template: PracticeTemplateTask[];
  onSave: (template: PracticeTemplateTask[]) => void;
  onCancel: () => void;
}

export default function TaskCustomizer({
  template,
  onSave,
  onCancel,
}: TaskCustomizerProps) {
  const [tasks, setTasks] = useState<PracticeTemplateTask[]>(template);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAddTask = () => {
    const newTask: PracticeTemplateTask = {
      id: createTaskId(),
      name: "New Task",
      duration: 5,
    };
    setTasks([...tasks, newTask]);
  };

  const handleDeleteTask = (id: string) => {
    setTasks(tasks.filter((t) => t.id !== id));
  };

  const handleUpdateTask = (
    id: string,
    updates: Partial<PracticeTemplateTask>,
  ) => {
    setTasks(
      tasks.map((t) =>
        t.id === id
          ? {
              ...t,
              ...updates,
              duration: Math.max(1, Math.floor(updates.duration || t.duration)),
            }
          : t,
      ),
    );
  };

  const handleMoveTask = (index: number, direction: "up" | "down") => {
    if (
      (direction === "up" && index === 0) ||
      (direction === "down" && index === tasks.length - 1)
    ) {
      return;
    }

    const newTasks = [...tasks];
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    [newTasks[index], newTasks[swapIndex]] = [
      newTasks[swapIndex],
      newTasks[index],
    ];
    setTasks(newTasks);
  };

  const handleSave = () => {
    onSave(tasks);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-lg max-w-2xl w-full max-h-screen overflow-y-auto">
        {/* Modal Header */}
        <div className="bg-blue-600 text-white p-6 sticky top-0">
          <h2 className="text-2xl font-bold">Edit Task Template</h2>
        </div>

        {/* Modal Content */}
        <div className="p-6">
          <div className="space-y-4 mb-6">
            {tasks.map((task, index) => (
              <div key={task.id} className="border border-gray-300 rounded p-4">
                <div className="flex gap-3 items-start mb-3">
                  {/* Task Name */}
                  <div className="flex-1">
                    {editingId === task.id ? (
                      <input
                        type="text"
                        value={task.name}
                        onChange={(e) =>
                          handleUpdateTask(task.id, { name: e.target.value })
                        }
                        placeholder="Task name"
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    ) : (
                      <div className="font-semibold text-gray-800">
                        {task.name}
                      </div>
                    )}
                  </div>

                  {/* Duration */}
                  <div className="w-24">
                    {editingId === task.id ? (
                      <input
                        type="number"
                        value={task.duration}
                        onChange={(e) =>
                          handleUpdateTask(task.id, {
                            duration: parseInt(e.target.value),
                          })
                        }
                        min="1"
                        className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    ) : (
                      <div className="text-gray-600">{task.duration} min</div>
                    )}
                  </div>
                </div>

                {/* Edit/Delete/Move Buttons */}
                <div className="flex gap-2 flex-wrap">
                  {editingId === task.id ? (
                    <>
                      <button
                        onClick={() => setEditingId(null)}
                        type="button"
                        className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                      >
                        Done
                      </button>
                      <button
                        onClick={() => {
                          setEditingId(null);
                          handleDeleteTask(task.id);
                        }}
                        type="button"
                        className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={() => setEditingId(task.id)}
                        type="button"
                        className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        type="button"
                        className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                      >
                        Delete
                      </button>
                    </>
                  )}

                  {/* Move Buttons */}
                  {index > 0 && (
                    <button
                      onClick={() => handleMoveTask(index, "up")}
                      type="button"
                      className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                    >
                      ↑
                    </button>
                  )}
                  {index < tasks.length - 1 && (
                    <button
                      onClick={() => handleMoveTask(index, "down")}
                      type="button"
                      className="px-3 py-1 bg-gray-600 text-white rounded text-sm hover:bg-gray-700"
                    >
                      ↓
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Add Task Button */}
          <button
            onClick={handleAddTask}
            type="button"
            className="w-full px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 mb-6"
          >
            + Add Task
          </button>
        </div>

        {/* Modal Footer */}
        <div className="border-t bg-gray-50 p-6 flex gap-3 justify-end sticky bottom-0">
          <button
            onClick={onCancel}
            type="button"
            className="px-6 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            type="button"
            className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Save Tasks
          </button>
        </div>
      </div>
    </div>
  );
}
